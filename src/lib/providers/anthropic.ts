import Anthropic from "@anthropic-ai/sdk";
import {
  MessageParam,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import { ServiceFunction, functionsToTools } from "../services";

export interface AnthropicToolCall {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
}

export interface AnthropicResponse {
  text?: string;
  toolCalls?: AnthropicToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
}

// Convert our tool format to Anthropic's format
function convertToolsForAnthropic(functions: ServiceFunction[]): Tool[] {
  const tools = functionsToTools(functions);

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: tool.parameters.properties || {},
      required: tool.parameters.required || [],
    },
  }));
}

export async function callAnthropic(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  messages: MessageParam[],
  functions: ServiceFunction[]
): Promise<AnthropicResponse> {
  const client = new Anthropic({
    apiKey,
  });

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 4096,
    system: systemPrompt,
    tools: convertToolsForAnthropic(functions),
    messages,
  });

  const anthropicResponse: AnthropicResponse = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason || undefined,
  };

  // Extract text and tool calls from content blocks
  for (const block of response.content) {
    if (block.type === "text") {
      anthropicResponse.text = (anthropicResponse.text || "") + block.text;
    }
    if (block.type === "tool_use") {
      const toolBlock = block as ToolUseBlock;
      if (!anthropicResponse.toolCalls) {
        anthropicResponse.toolCalls = [];
      }
      anthropicResponse.toolCalls.push({
        id: toolBlock.id,
        name: toolBlock.name,
        args: toolBlock.input as Record<string, unknown>,
      });
    }
  }

  return anthropicResponse;
}

// Create content blocks from text and tool calls for assistant message
export function createAssistantContent(
  text?: string,
  toolCalls?: AnthropicToolCall[]
): ContentBlock[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];

  if (text) {
    content.push({ type: "text", text });
  }

  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.args,
      });
    }
  }

  return content as ContentBlock[];
}

// Create a tool result message
export function createToolResultContent(
  toolCallId: string,
  result: string
): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: toolCallId,
    content: result,
  };
}

// Create a text content block for user messages
export function createTextContent(text: string): TextBlockParam {
  return {
    type: "text",
    text,
  };
}
