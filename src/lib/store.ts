// Client-side state management for the playground
import { services, defaultAgentPreset } from "./services";

export interface TraceEntry {
  id: string;
  timestamp: Date;
  type: "tool_call" | "tool_result" | "text" | "user_input" | "error";
  content: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: Record<string, any>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolCalls: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls?: Array<{ id: string; name: string; args: Record<string, any> }>;
  toolResults?: Array<{ id: string; name: string; result: string }>;
}

export interface ServiceData {
  name: string;
  displayName: string;
  data: Record<string, unknown>;
  error?: string;
}

export interface WorldContext {
  profile: Record<string, unknown> | null;
  credentials: Array<{ account_name: string; password: string }> | null;
  services: ServiceData[];
}

export type ModelProvider = "gemini" | "anthropic" | "openai";

export interface PlaygroundState {
  // Configuration
  provider: ModelProvider;
  modelName: string;
  apiKey: string;
  taskId: string;
  enabledServices: string[];
  systemPrompt: string;

  // Session state
  gaesaCookie: string | null;
  isInitialized: boolean;
  isRunning: boolean;
  shouldStop: boolean;
  needsUserInput: boolean;

  // Trace
  trace: TraceEntry[];
  tokenUsage: TokenUsage;
  conversationMessages: ConversationMessage[];

  // World context (lazy loaded)
  worldContext: WorldContext | null;
  isLoadingWorldContext: boolean;
}

export const defaultState: PlaygroundState = {
  provider: "gemini",
  modelName: "gemini-3-flash-preview",
  apiKey: "",
  taskId: "b0a8eae_1",
  enabledServices: services.map((s) => s.name),
  systemPrompt: defaultAgentPreset.systemPrompt,
  gaesaCookie: null,
  isInitialized: false,
  isRunning: false,
  shouldStop: false,
  needsUserInput: false,
  trace: [],
  tokenUsage: {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    toolCalls: 0,
  },
  conversationMessages: [],
  worldContext: null,
  isLoadingWorldContext: false,
};

// Local storage keys
const STORAGE_KEYS = {
  PROVIDER: "appworld_provider",
  API_KEY: "appworld_api_key",
  MODEL_NAME: "appworld_model_name",
  TASK_ID: "appworld_task_id",
  ENABLED_SERVICES: "appworld_enabled_services",
  SYSTEM_PROMPT: "appworld_system_prompt",
} as const;

// Load persisted state from localStorage
export function loadPersistedState(): Partial<PlaygroundState> {
  if (typeof window === "undefined") return {};

  try {
    const providerStr = localStorage.getItem(STORAGE_KEYS.PROVIDER);
    const provider: ModelProvider = (providerStr === "gemini" || providerStr === "anthropic" || providerStr === "openai")
      ? providerStr
      : defaultState.provider;
    const apiKey = localStorage.getItem(STORAGE_KEYS.API_KEY) || "";
    const modelName = localStorage.getItem(STORAGE_KEYS.MODEL_NAME) || defaultState.modelName;
    const taskId = localStorage.getItem(STORAGE_KEYS.TASK_ID) || defaultState.taskId;
    const enabledServicesJson = localStorage.getItem(STORAGE_KEYS.ENABLED_SERVICES);
    const enabledServices = enabledServicesJson
      ? JSON.parse(enabledServicesJson)
      : defaultState.enabledServices;
    const systemPrompt = localStorage.getItem(STORAGE_KEYS.SYSTEM_PROMPT) || defaultState.systemPrompt;

    return {
      provider,
      apiKey,
      modelName,
      taskId,
      enabledServices,
      systemPrompt,
    };
  } catch {
    return {};
  }
}

// Persist state to localStorage
export function persistState(state: Partial<PlaygroundState>) {
  if (typeof window === "undefined") return;

  try {
    if (state.provider !== undefined) {
      localStorage.setItem(STORAGE_KEYS.PROVIDER, state.provider);
    }
    if (state.apiKey !== undefined) {
      localStorage.setItem(STORAGE_KEYS.API_KEY, state.apiKey);
    }
    if (state.modelName !== undefined) {
      localStorage.setItem(STORAGE_KEYS.MODEL_NAME, state.modelName);
    }
    if (state.taskId !== undefined) {
      localStorage.setItem(STORAGE_KEYS.TASK_ID, state.taskId);
    }
    if (state.enabledServices !== undefined) {
      localStorage.setItem(STORAGE_KEYS.ENABLED_SERVICES, JSON.stringify(state.enabledServices));
    }
    if (state.systemPrompt !== undefined) {
      localStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, state.systemPrompt);
    }
  } catch {
    // Ignore localStorage errors
  }
}

// Generate unique ID for trace entries
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
