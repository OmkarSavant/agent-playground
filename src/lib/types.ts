// AppWorld API types
export type AppWorldAction = "initialize" | "execute" | "evaluate";

export interface AppWorldRequest {
  action: AppWorldAction;
  task_id: string;
  code?: string;
  cookie?: string;
}

export interface AppWorldResponse {
  output?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsed_output?: any;
  cookie?: string;
  error?: string;
  details?: string;
  success?: boolean;
}

// Agent types
export type ModelProvider = "gemini" | "anthropic" | "openai";

export interface AgentConfig {
  provider: ModelProvider;
  modelName: string;
  apiKey: string;
  enabledServices: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolCalls: number;
}

export interface TraceEntry {
  id: string;
  timestamp: Date;
  type: "tool_call" | "tool_result" | "text" | "user_input" | "error";
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

// Service/Tool types
export interface ServiceFunction {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>; // Zod schema as JSON
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toCode: (args: Record<string, any>) => string;
}

export interface Service {
  name: string;
  displayName: string;
  description: string;
  functions: ServiceFunction[];
}

// Agent presets
export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  enabledServices: string[];
  systemPrompt: string;
}
