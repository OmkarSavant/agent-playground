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

import { ModelProvider } from "@/lib/store";

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

// SSE Event types
interface TraceEvent {
  type: "trace";
  entry: {
    type: "tool_call" | "tool_result" | "text" | "error";
    content: string;
    name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: Record<string, any>;
    timestamp: string;
  };
}

interface TokenEvent {
  type: "tokens";
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolCallCount: number;
}

interface DoneEvent {
  type: "done";
  completed: boolean;
  needsUserInput: boolean;
}

interface ErrorEvent {
  type: "error";
  error: string;
  details?: string;
}

type SSEEvent = TraceEvent | TokenEvent | DoneEvent | ErrorEvent;

// Validate provider from header
function validateProvider(providerHeader: string | null): ModelProvider {
  if (providerHeader === "gemini" || providerHeader === "anthropic" || providerHeader === "openai") {
    return providerHeader;
  }
  return "gemini";
}

// Execute a tool call via AppWorld API
async function executeToolCall(
  toolCall: ToolCall,
  taskId: string,
  cookie: string,
  baseUrl: string
): Promise<string> {
  const fn = getFunctionByName(toolCall.name);
  if (!fn) {
    console.error(`[Tool Error] Unknown function: ${toolCall.name}`);
    return `Error: Unknown function "${toolCall.name}"`;
  }

  const code = fn.toCode(toolCall.args);
  console.log(`[Tool Call] ${toolCall.name}`, { args: toolCall.args, code });

  try {
    const url = `${baseUrl}/api/appworld`;
    console.log(`[Tool Fetch] POST ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        task_id: taskId,
        code,
        cookie,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Tool Error] HTTP ${response.status}: ${errorText}`);
      return `Error: HTTP ${response.status} - ${errorText}`;
    }

    const data = await response.json();
    console.log(`[Tool Result] ${toolCall.name}`, { output: data.output?.substring(0, 200) });

    if (data.error) {
      console.error(`[Tool Error] ${toolCall.name}:`, data.error, data.details);
      return `Error: ${data.error}${data.details ? ` - ${data.details}` : ""}`;
    }

    if (data.parsed_output !== undefined) {
      return typeof data.parsed_output === "string"
        ? data.parsed_output
        : JSON.stringify(data.parsed_output, null, 2);
    }

    return data.output || "No output";
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : "";
    console.error(`[Tool Error] ${toolCall.name} fetch failed:`, errorMsg, errorStack);
    return `Error executing tool: ${errorMsg}`;
  }
}

// Helper to format SSE event
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Streaming Gemini agent loop
async function* runGeminiLoopStreaming(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: GeminiMessage[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  baseUrl: string,
  maxIterations: number = 50
): AsyncGenerator<SSEEvent> {
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let toolCallCount = 0;
  let completed = false;

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

    // Emit token update
    yield {
      type: "tokens",
      inputTokens,
      outputTokens,
      thinkingTokens,
      toolCallCount,
    };

    // Handle text response
    if (response.text) {
      yield {
        type: "trace",
        entry: {
          type: "text",
          content: response.text,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // No tool calls - agent is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      yield {
        type: "done",
        completed,
        needsUserInput: !!response.text,
      };
      return;
    }

    const responseParts = [];

    for (const tc of response.toolCalls) {
      toolCallCount++;

      // Emit tool call
      yield {
        type: "trace",
        entry: {
          type: "tool_call",
          content: `${tc.name}(${JSON.stringify(tc.args)})`,
          name: tc.name,
          args: tc.args,
          timestamp: new Date().toISOString(),
        },
      };

      // Emit updated tool count
      yield {
        type: "tokens",
        inputTokens,
        outputTokens,
        thinkingTokens,
        toolCallCount,
      };

      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      // Execute the tool
      const result = await executeToolCall(
        { id: `call_${i}_${toolCallCount}`, name: tc.name, args: tc.args },
        taskId,
        cookie,
        baseUrl
      );

      // Emit tool result
      yield {
        type: "trace",
        entry: {
          type: "tool_result",
          content: result,
          name: tc.name,
          timestamp: new Date().toISOString(),
        },
      };

      responseParts.push(createFunctionResponsePart(tc.name, result));
    }

    if (response.modelParts && response.modelParts.length > 0) {
      messages.push(createModelMessageFromParts(response.modelParts));
    }
    messages.push({ role: "user", parts: responseParts });

    if (completed) {
      break;
    }
  }

  yield {
    type: "done",
    completed,
    needsUserInput: false,
  };
}

// Streaming Anthropic agent loop
async function* runAnthropicLoopStreaming(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: MessageParam[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  baseUrl: string,
  maxIterations: number = 50
): AsyncGenerator<SSEEvent> {
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let completed = false;

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

    yield {
      type: "tokens",
      inputTokens,
      outputTokens,
      thinkingTokens: 0,
      toolCallCount,
    };

    if (response.text) {
      yield {
        type: "trace",
        entry: {
          type: "text",
          content: response.text,
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      yield {
        type: "done",
        completed,
        needsUserInput: !!response.text,
      };
      return;
    }

    messages.push({
      role: "assistant",
      content: createAssistantContent(response.text, response.toolCalls),
    });

    const toolResults: Array<ReturnType<typeof createToolResultContent>> = [];

    for (const tc of response.toolCalls) {
      toolCallCount++;

      yield {
        type: "trace",
        entry: {
          type: "tool_call",
          content: `${tc.name}(${JSON.stringify(tc.args)})`,
          name: tc.name,
          args: tc.args,
          timestamp: new Date().toISOString(),
        },
      };

      yield {
        type: "tokens",
        inputTokens,
        outputTokens,
        thinkingTokens: 0,
        toolCallCount,
      };

      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      const result = await executeToolCall(
        { id: tc.id, name: tc.name, args: tc.args },
        taskId,
        cookie,
        baseUrl
      );

      yield {
        type: "trace",
        entry: {
          type: "tool_result",
          content: result,
          name: tc.name,
          timestamp: new Date().toISOString(),
        },
      };

      toolResults.push(createToolResultContent(tc.id, result));
    }

    messages.push({
      role: "user",
      content: toolResults,
    });

    if (completed) {
      break;
    }
  }

  yield {
    type: "done",
    completed,
    needsUserInput: false,
  };
}

// Streaming OpenAI agent loop
async function* runOpenAILoopStreaming(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  initialMessages: ChatCompletionMessageParam[],
  functions: ServiceFunction[],
  taskId: string,
  cookie: string,
  baseUrl: string,
  maxIterations: number = 50
): AsyncGenerator<SSEEvent> {
  const messages = [...initialMessages];
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallCount = 0;
  let completed = false;

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

    yield {
      type: "tokens",
      inputTokens,
      outputTokens,
      thinkingTokens: 0,
      toolCallCount,
    };

    if (response.text) {
      yield {
        type: "trace",
        entry: {
          type: "text",
          content: response.text,
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      yield {
        type: "done",
        completed,
        needsUserInput: !!response.text,
      };
      return;
    }

    messages.push(createAssistantMessage(response.text, response.toolCalls));

    for (const tc of response.toolCalls) {
      toolCallCount++;

      yield {
        type: "trace",
        entry: {
          type: "tool_call",
          content: `${tc.name}(${JSON.stringify(tc.args)})`,
          name: tc.name,
          args: tc.args,
          timestamp: new Date().toISOString(),
        },
      };

      yield {
        type: "tokens",
        inputTokens,
        outputTokens,
        thinkingTokens: 0,
        toolCallCount,
      };

      if (tc.name === "supervisor_complete_task") {
        completed = true;
      }

      const result = await executeToolCall(
        { id: tc.id, name: tc.name, args: tc.args },
        taskId,
        cookie,
        baseUrl
      );

      yield {
        type: "trace",
        entry: {
          type: "tool_result",
          content: result,
          name: tc.name,
          timestamp: new Date().toISOString(),
        },
      };

      messages.push(createToolResultMessage(tc.id, result));
    }

    if (completed) {
      break;
    }
  }

  yield {
    type: "done",
    completed,
    needsUserInput: false,
  };
}

export async function POST(request: NextRequest) {
  try {
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;
    console.log(`[Chat API] Using base URL: ${baseUrl}`);

    const providerHeader = request.headers.get("x-model-provider");
    const apiKey = request.headers.get("x-api-key");
    const modelName = request.headers.get("x-model-name") || "gemini-3-flash-preview";
    const enabledServicesHeader = request.headers.get("x-enabled-services");

    if (!apiKey) {
      return Response.json({ error: "Missing x-api-key header" }, { status: 400 });
    }

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

    const provider = validateProvider(providerHeader);
    const functions = getEnabledFunctions(enabledServices);

    const body: ChatRequest = await request.json();
    const { messages, systemPrompt, taskId, cookie } = body;

    if (!taskId || !cookie) {
      return Response.json(
        { error: "Missing taskId or cookie. Initialize the world state first." },
        { status: 400 }
      );
    }

    // Create streaming response
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let eventGenerator: AsyncGenerator<SSEEvent>;

          if (provider === "gemini") {
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
              if (msg.toolResults) {
                geminiMessages.push({
                  role: "user",
                  parts: msg.toolResults.map((tr) =>
                    createFunctionResponsePart(tr.name, tr.result)
                  ),
                });
              }
            }

            eventGenerator = runGeminiLoopStreaming(
              apiKey,
              modelName,
              systemPrompt,
              geminiMessages,
              functions,
              taskId,
              cookie,
              baseUrl
            );
          } else if (provider === "anthropic") {
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
              if (msg.toolResults) {
                anthropicMessages.push({
                  role: "user",
                  content: msg.toolResults.map((tr) =>
                    createToolResultContent(tr.id || `tool_${0}`, tr.result)
                  ),
                });
              }
            }

            eventGenerator = runAnthropicLoopStreaming(
              apiKey,
              modelName,
              systemPrompt,
              anthropicMessages,
              functions,
              taskId,
              cookie,
              baseUrl
            );
          } else {
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
              if (msg.toolResults) {
                for (const tr of msg.toolResults) {
                  openaiMessages.push(
                    createToolResultMessage(tr.id || `call_${0}`, tr.result)
                  );
                }
              }
            }

            eventGenerator = runOpenAILoopStreaming(
              apiKey,
              modelName,
              systemPrompt,
              openaiMessages,
              functions,
              taskId,
              cookie,
              baseUrl
            );
          }

          // Stream events
          for await (const event of eventGenerator) {
            controller.enqueue(encoder.encode(formatSSE(event)));
          }

          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          const errorEvent: ErrorEvent = {
            type: "error",
            error: "Agent error",
            details: error instanceof Error ? error.message : "Unknown error",
          };
          controller.enqueue(encoder.encode(formatSSE(errorEvent)));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
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
