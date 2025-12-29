import {
  GoogleGenerativeAI,
  Part,
  Content,
  FunctionCall,
  SchemaType,
} from "@google/generative-ai";
import { ServiceFunction, functionsToTools } from "../services";

export interface GeminiMessage {
  role: "user" | "model";
  parts: Part[];
}

export interface GeminiToolCall {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
}

export interface GeminiResponse {
  text?: string;
  toolCalls?: GeminiToolCall[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason?: string;
  // For Gemini 3: preserve all model parts for recirculation
  modelParts?: Part[];
}

// Convert our tool format to Gemini's format
function convertToolsForGemini(functions: ServiceFunction[]) {
  const tools = functionsToTools(functions);

  return {
    functionDeclarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    })),
  };
}

export async function callGemini(
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  messages: GeminiMessage[],
  functions: ServiceFunction[]
): Promise<GeminiResponse> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Detect if this is a Gemini 3 model that supports thinking
  const isGemini3 = modelName.toLowerCase().includes("gemini-3") ||
                    modelName.toLowerCase().includes("gemini-2.5");

  // Configure model with thinking enabled for Gemini 3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelConfig: any = {
    model: modelName,
    systemInstruction: systemPrompt,
    tools: [convertToolsForGemini(functions)],
  };

  // Enable thinking for Gemini 3 models
  if (isGemini3) {
    modelConfig.generationConfig = {
      ...modelConfig.generationConfig,
      thinkingConfig: {
        thinkingBudget: 8192, // Allow up to 8k thinking tokens
      },
    };
  }

  const model = genAI.getGenerativeModel(modelConfig);

  // Convert messages to Gemini content format
  const contents: Content[] = messages.map((msg) => ({
    role: msg.role,
    parts: msg.parts,
  }));

  const result = await model.generateContent({
    contents,
  });

  const response = result.response;
  const candidate = response.candidates?.[0];

  if (!candidate) {
    throw new Error("No response candidate from Gemini");
  }

  // Calculate thinking tokens from usage metadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usageMetadata = response.usageMetadata as any;
  const promptTokens = usageMetadata?.promptTokenCount || 0;
  const candidateTokens = usageMetadata?.candidatesTokenCount || 0;
  // thoughtsTokenCount is available for Gemini 3 models
  const thoughtsTokens = usageMetadata?.thoughtsTokenCount || 0;

  const geminiResponse: GeminiResponse = {
    inputTokens: promptTokens,
    outputTokens: candidateTokens - thoughtsTokens, // Output tokens exclude thinking
    thinkingTokens: thoughtsTokens,
    finishReason: candidate.finishReason,
    modelParts: [], // Will store all parts for recirculation
  };

  // Extract text, function calls, and thinking from parts
  // For Gemini 3, we need to preserve ALL parts including thinking for recirculation
  const parts = candidate.content?.parts || [];

  for (const part of parts) {
    // Store all parts for recirculation (Gemini 3 requirement)
    geminiResponse.modelParts!.push(part);

    if ("text" in part && part.text) {
      // Skip thinking text from being shown to user, but keep in modelParts
      // Thinking parts typically have a specific structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyPart = part as any;
      if (!anyPart.thought) {
        geminiResponse.text = (geminiResponse.text || "") + part.text;
      }
    }
    if ("functionCall" in part && part.functionCall) {
      const fc = part.functionCall as FunctionCall;
      if (!geminiResponse.toolCalls) {
        geminiResponse.toolCalls = [];
      }
      geminiResponse.toolCalls.push({
        name: fc.name,
        args: fc.args as Record<string, unknown>,
      });
    }
  }

  return geminiResponse;
}

// Create a function response part for Gemini
export function createFunctionResponsePart(
  name: string,
  response: string
): Part {
  return {
    functionResponse: {
      name,
      response: { result: response },
    },
  };
}

// Create a function call part (for model messages)
export function createFunctionCallPart(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>
): Part {
  return {
    functionCall: {
      name,
      args,
    },
  };
}

// Create a model message from response parts (for Gemini 3 recirculation)
// This preserves thinking parts, function calls, and text together
export function createModelMessageFromParts(parts: Part[]): GeminiMessage {
  return {
    role: "model",
    parts: parts,
  };
}
