import { NextRequest } from "next/server";
import {
  getEnabledFunctions,
  getFunctionByName,
  ServiceFunction,
} from "@/lib/services";
import {
  callGemini,
  GeminiMessage,
  createFunctionResponsePart,
  createFunctionCallPart,
  createModelMessageFromParts,
} from "@/lib/providers/gemini";
import {
  callAnthropic,
  AnthropicToolCall,
  createAssistantContent,
  createToolResultContent,
  createTextContent,
} from "@/lib/providers/anthropic";
import {
  callOpenAI,
  OpenAIToolCall,
  createAssistantMessage,
  createToolResultMessage,
} from "@/lib/providers/openai";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

type ModelProvider = "gemini" | "anthropic" | "openai";

interface ChatRequest {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolCalls?: Array<{ id?: string; name: string; args: Record<string, any> }>;
    toolResults?: Array<{ id?: string; name: string; result: string }>;
  }>;
  systemPrompt: string;
  taskId: string;
  cookie: string; // GAESA cookie for AppWorld API
}

interface ToolCall {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
}

interface TraceEntry {
  type: "tool_call" | "tool_result" | "text" | "error";
  content: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: Record<string, any>;
  timestamp: string;
}

interface AgentLoopResult {
  trace: TraceEntry[];
  finalText?: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolCallCount: number;
  completed: boolean; // Did agent call supervisor_complete_task?
  needsUserInput: boolean; // Did agent ask a question?
}

// Detect provider from model name
function detectProvider(modelName: string): ModelProvider {
  const name = modelName.toLowerCase();
  if (
    name.includes("gemini") ||
    name.includes("gemma") ||
    name.startsWith("models/")
  ) {
    return "gemini";
  }
  if (
    name.includes("claude") ||
    name.includes("anthropic") ||
    name.startsWith("claude-")
  ) {
    return "anthropic";
  }
  // Default to OpenAI for gpt-*, o1-*, etc.
  return "openai";
}

// Execute a tool call via AppWorld API
async function executeToolCall(
  toolCall: ToolCall,
  taskId: string,
  cookie: string
): Promise<string> {
  const fn = getFunctionByName(toolCall.name);
  if (!fn) {
    return `Error: Unknown function "${toolCall.name}"`;
  }

  // Generate Python code
  const code = fn.toCode(toolCall.args);

  // Call AppWorld execute API
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/appworld`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          task_id: taskId,
          code,
          cookie,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return `Error: ${data.error}${data.details ? ` - ${data.details}` : ""}`;
    }

    // Return the parsed output or raw output
    if (data.parsed_output !== undefined) {
      return typeof data.parsed_output === "string"
        ? data.parsed_output
        : JSON.stringify(data.parsed_output, null, 2);
    }

    return data.output || "No output";
  } catch (error) {
    return `Error executing tool: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

// Run the agentic loop for Gemini (supports Gemini 3 thought recirculation)
async function runGeminiLoop(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: GeminiMessage[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  maxIterations: number = 50
): Promise<AgentLoopResult> {
  const trace: TraceEntry[] = [];
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let toolCallCount = 0;
  let completed = false;
  let finalText: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    const response = await callGemini(
      apiKey,
      modelName,
      systemPrompt,
      messages,
      functions
    );

    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    thinkingTokens += response.thinkingTokens;

    // Handle text response
    if (response.text) {
      trace.push({
        type: "text",
        content: response.text,
        timestamp: new Date().toISOString(),
      });
      finalText = response.text;
    }

    // No tool calls - agent is done or needs input
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        trace,
        finalText,
        inputTokens,
        outputTokens,
        thinkingTokens,
        toolCallCount,
        completed,
        needsUserInput: !!response.text,
      };
    }

    // For Gemini 3: Use modelParts for recirculation (preserves thinking signatures)
    // This is critical - we must pass back ALL model parts including thinking
    const responseParts = [];

    for (const tc of response.toolCalls) {
      toolCallCount++;

      trace.push({
        type: "tool_call",
        content: `${tc.name}(${JSON.stringify(tc.args)})`,
        name: tc.name,
        args: tc.args,
        timestamp: new Date().toISOString(),
      });

      // Check for completion
      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      // Execute the tool
      const result = await executeToolCall(
        { id: `call_${i}_${toolCallCount}`, name: tc.name, args: tc.args },
        taskId,
        cookie
      );

      trace.push({
        type: "tool_result",
        content: result,
        name: tc.name,
        timestamp: new Date().toISOString(),
      });

      responseParts.push(createFunctionResponsePart(tc.name, result));
    }

    // CRITICAL for Gemini 3: Use the complete modelParts from response
    // This preserves thinking signatures for proper recirculation
    if (response.modelParts && response.modelParts.length > 0) {
      messages.push(createModelMessageFromParts(response.modelParts));
    }
    messages.push({ role: "user", parts: responseParts });

    // If completed, break
    if (completed) {
      break;
    }
  }

  return {
    trace,
    finalText,
    inputTokens,
    outputTokens,
    thinkingTokens,
    toolCallCount,
    completed,
    needsUserInput: false,
  };
}

// Run the agentic loop for Anthropic
async function runAnthropicLoop(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: MessageParam[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  maxIterations: number = 50
): Promise<AgentLoopResult> {
  const trace: TraceEntry[] = [];
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let completed = false;
  let finalText: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    const response = await callAnthropic(
      apiKey,
      modelName,
      systemPrompt,
      messages,
      functions
    );

    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;

    // Handle text response
    if (response.text) {
      trace.push({
        type: "text",
        content: response.text,
        timestamp: new Date().toISOString(),
      });
      finalText = response.text;
    }

    // No tool calls - agent is done or needs input
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        trace,
        finalText,
        inputTokens,
        outputTokens,
        thinkingTokens: 0,
        toolCallCount,
        completed,
        needsUserInput: !!response.text,
      };
    }

    // Add assistant message with tool calls
    messages.push({
      role: "assistant",
      content: createAssistantContent(response.text, response.toolCalls),
    });

    // Process tool calls
    const toolResults: Array<ReturnType<typeof createToolResultContent>> = [];

    for (const tc of response.toolCalls) {
      toolCallCount++;

      trace.push({
        type: "tool_call",
        content: `${tc.name}(${JSON.stringify(tc.args)})`,
        name: tc.name,
        args: tc.args,
        timestamp: new Date().toISOString(),
      });

      // Check for completion
      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      // Execute the tool
      const result = await executeToolCall(
        { id: tc.id, name: tc.name, args: tc.args },
        taskId,
        cookie
      );

      trace.push({
        type: "tool_result",
        content: result,
        name: tc.name,
        timestamp: new Date().toISOString(),
      });

      toolResults.push(createToolResultContent(tc.id, result));
    }

    // Add tool results as user message
    messages.push({
      role: "user",
      content: toolResults,
    });

    // If completed, break
    if (completed) {
      break;
    }
  }

  return {
    trace,
    finalText,
    inputTokens,
    outputTokens,
    thinkingTokens: 0,
    toolCallCount,
    completed,
    needsUserInput: false,
  };
}

// Run the agentic loop for OpenAI
async function runOpenAILoop(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: ChatCompletionMessageParam[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  maxIterations: number = 50
): Promise<AgentLoopResult> {
  const trace: TraceEntry[] = [];
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let completed = false;
  let finalText: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
    const response = await callOpenAI(
      apiKey,
      modelName,
      systemPrompt,
      messages,
      functions
    );

    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;

    // Handle text response
    if (response.text) {
      trace.push({
        type: "text",
        content: response.text,
        timestamp: new Date().toISOString(),
      });
      finalText = response.text;
    }

    // No tool calls - agent is done or needs input
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        trace,
        finalText,
        inputTokens,
        outputTokens,
        thinkingTokens: 0,
        toolCallCount,
        completed,
        needsUserInput: !!response.text,
      };
    }

    // Add assistant message with tool calls
    messages.push(createAssistantMessage(response.text, response.toolCalls));

    // Process tool calls
    for (const tc of response.toolCalls) {
      toolCallCount++;

      trace.push({
        type: "tool_call",
        content: `${tc.name}(${JSON.stringify(tc.args)})`,
        name: tc.name,
        args: tc.args,
        timestamp: new Date().toISOString(),
      });

      // Check for completion
      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      // Execute the tool
      const result = await executeToolCall(
        { id: tc.id, name: tc.name, args: tc.args },
        taskId,
        cookie
      );

      trace.push({
        type: "tool_result",
        content: result,
        name: tc.name,
        timestamp: new Date().toISOString(),
      });

      // Add tool result
      messages.push(createToolResultMessage(tc.id, result));
    }

    // If completed, break
    if (completed) {
      break;
    }
  }

  return {
    trace,
    finalText,
    inputTokens,
    outputTokens,
    thinkingTokens: 0,
    toolCallCount,
    completed,
    needsUserInput: false,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Get headers
    const providerHeader = request.headers.get("x-model-provider");
    const apiKey = request.headers.get("x-api-key");
    const modelName = request.headers.get("x-model-name") || "gemini-2.0-flash";
    const enabledServicesHeader = request.headers.get("x-enabled-services");

    if (!apiKey) {
      return Response.json({ error: "Missing x-api-key header" }, { status: 400 });
    }

    // Parse enabled services
    const enabledServices = enabledServicesHeader
      ? enabledServicesHeader.split(",").map((s) => s.trim())
      : [
          "spotify",
          "gmail",
          "venmo",
          "amazon",
          "todoist",
          "simple_note",
          "splitwise",
          "phone",
          "file_system",
        ];

    // Detect provider
    const provider: ModelProvider = providerHeader
      ? (providerHeader as ModelProvider)
      : detectProvider(modelName);

    // Get enabled functions
    const functions = getEnabledFunctions(enabledServices);

    // Parse request body
    const body: ChatRequest = await request.json();
    const { messages, systemPrompt, taskId, cookie } = body;

    if (!taskId || !cookie) {
      return Response.json(
        { error: "Missing taskId or cookie. Initialize the world state first." },
        { status: 400 }
      );
    }

    // Run the appropriate agent loop
    let result: AgentLoopResult;

    if (provider === "gemini") {
      // Convert messages to Gemini format
      const geminiMessages: GeminiMessage[] = [];
      for (const msg of messages) {
        if (msg.role === "user") {
          geminiMessages.push({
            role: "user",
            parts: [{ text: msg.content }],
          });
        } else if (msg.role === "assistant") {
          if (msg.toolCalls) {
            geminiMessages.push({
              role: "model",
              parts: msg.toolCalls.map((tc) =>
                createFunctionCallPart(tc.name, tc.args)
              ),
            });
          } else {
            geminiMessages.push({
              role: "model",
              parts: [{ text: msg.content }],
            });
          }
        }
        // Handle tool results
        if (msg.toolResults) {
          geminiMessages.push({
            role: "user",
            parts: msg.toolResults.map((tr) =>
              createFunctionResponsePart(tr.name, tr.result)
            ),
          });
        }
      }

      result = await runGeminiLoop(
        apiKey,
        modelName,
        systemPrompt,
        geminiMessages,
        functions,
        taskId,
        cookie
      );
    } else if (provider === "anthropic") {
      // Convert messages to Anthropic format
      const anthropicMessages: MessageParam[] = [];
      for (const msg of messages) {
        if (msg.role === "user") {
          anthropicMessages.push({
            role: "user",
            content: [createTextContent(msg.content)],
          });
        } else if (msg.role === "assistant") {
          if (msg.toolCalls) {
            const toolCalls: AnthropicToolCall[] = msg.toolCalls.map(
              (tc, idx) => ({
                id: tc.id || `tool_${idx}`,
                name: tc.name,
                args: tc.args,
              })
            );
            anthropicMessages.push({
              role: "assistant",
              content: createAssistantContent(msg.content, toolCalls),
            });
          } else {
            anthropicMessages.push({
              role: "assistant",
              content: msg.content,
            });
          }
        }
        // Handle tool results
        if (msg.toolResults) {
          anthropicMessages.push({
            role: "user",
            content: msg.toolResults.map((tr) =>
              createToolResultContent(tr.id || `tool_${0}`, tr.result)
            ),
          });
        }
      }

      result = await runAnthropicLoop(
        apiKey,
        modelName,
        systemPrompt,
        anthropicMessages,
        functions,
        taskId,
        cookie
      );
    } else {
      // OpenAI
      const openaiMessages: ChatCompletionMessageParam[] = [];
      for (const msg of messages) {
        if (msg.role === "user") {
          openaiMessages.push({
            role: "user",
            content: msg.content,
          });
        } else if (msg.role === "assistant") {
          if (msg.toolCalls) {
            const toolCalls: OpenAIToolCall[] = msg.toolCalls.map((tc, idx) => ({
              id: tc.id || `call_${idx}`,
              name: tc.name,
              args: tc.args,
            }));
            openaiMessages.push(createAssistantMessage(msg.content, toolCalls));
          } else {
            openaiMessages.push({
              role: "assistant",
              content: msg.content,
            });
          }
        }
        // Handle tool results
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            openaiMessages.push(
              createToolResultMessage(tr.id || `call_${0}`, tr.result)
            );
          }
        }
      }

      result = await runOpenAILoop(
        apiKey,
        modelName,
        systemPrompt,
        openaiMessages,
        functions,
        taskId,
        cookie
      );
    }

    return Response.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json(
      {
        error: "Chat API error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
