import OpenAI from "openai";
import {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionAssistantMessageParam,
} from "openai/resources/chat/completions";
import { ServiceFunction, functionsToTools } from "../services";

export interface OpenAIToolCall {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
}

export interface OpenAIResponse {
  text?: string;
  toolCalls?: OpenAIToolCall[];
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
}

// Convert our tool format to OpenAI's format
function convertToolsForOpenAI(functions: ServiceFunction[]): ChatCompletionTool[] {
  const tools = functionsToTools(functions);

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    },
  }));
}

export async function callOpenAI(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  messages: ChatCompletionMessageParam[],
  functions: ServiceFunction[]
): Promise<OpenAIResponse> {
  const client = new OpenAI({
    apiKey,
  });

  // Prepend system message
  const allMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const response = await client.chat.completions.create({
    model: modelName,
    messages: allMessages,
    tools: convertToolsForOpenAI(functions),
    tool_choice: "auto",
  });

  const choice = response.choices[0];
  if (!choice) {
    throw new Error("No response choice from OpenAI");
  }

  const openaiResponse: OpenAIResponse = {
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
    finishReason: choice.finish_reason || undefined,
  };

  // Extract text content
  if (choice.message.content) {
    openaiResponse.text = choice.message.content;
  }

  // Extract tool calls
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    openaiResponse.toolCalls = choice.message.tool_calls.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || "{}"),
    }));
  }

  return openaiResponse;
}

// Create an assistant message with tool calls
export function createAssistantMessage(
  text?: string,
  toolCalls?: OpenAIToolCall[]
): ChatCompletionAssistantMessageParam {
  const message: ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: text || null,
  };

  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.args),
      },
    }));
  }

  return message;
}

// Create a tool result message
export function createToolResultMessage(
  toolCallId: string,
  result: string
): ChatCompletionToolMessageParam {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: result,
  };
}
