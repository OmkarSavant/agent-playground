"use client";

import { useState, useEffect, useCallback } from "react";
import { LeftSidebar } from "@/components/left-sidebar";
import { CenterPanel } from "@/components/center-panel";
import { RightPanel } from "@/components/right-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PlaygroundState,
  TraceEntry,
  defaultState,
  loadPersistedState,
  persistState,
  generateId,
} from "@/lib/store";
import { services, generateSystemPrompt } from "@/lib/services";

export default function Home() {
  const [state, setState] = useState<PlaygroundState>(defaultState);
  const [infoOpen, setInfoOpen] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Load persisted state on mount
  useEffect(() => {
    const persisted = loadPersistedState();
    setState((prev) => ({ ...prev, ...persisted }));
  }, []);

  // Persist state changes
  const updateState = useCallback(
    (updates: Partial<PlaygroundState>) => {
      setState((prev) => {
        const newState = { ...prev, ...updates };
        persistState(updates);
        return newState;
      });
    },
    []
  );

  // Add trace entry
  const addTraceEntry = useCallback(
    (
      type: TraceEntry["type"],
      content: string,
      name?: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args?: Record<string, any>
    ) => {
      const entry: TraceEntry = {
        id: generateId(),
        timestamp: new Date(),
        type,
        content,
        name,
        args,
      };
      setState((prev) => ({
        ...prev,
        trace: [...prev.trace, entry],
      }));
    },
    []
  );

  // Initialize world state
  const handleInitialize = async () => {
    try {
      addTraceEntry("text", `Initializing world state for task ${state.taskId}...`);

      const response = await fetch("/api/appworld", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initialize",
          task_id: state.taskId,
        }),
      });

      const data = await response.json();

      if (data.error) {
        addTraceEntry("error", `Initialization failed: ${data.error}`);
        return;
      }

      // Store cookie and update state, reset world context for new task
      setState((prev) => ({
        ...prev,
        gaesaCookie: data.cookie || null,
        isInitialized: true,
        worldContext: null,
      }));

      addTraceEntry("text", "World state initialized successfully.");

      // Get passwords to populate system prompt
      if (data.cookie) {
        const passwordsResponse = await fetch("/api/appworld", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "execute",
            task_id: state.taskId,
            code: "print(apis.supervisor.show_account_passwords())",
            cookie: data.cookie,
          }),
        });

        const passwordsData = await passwordsResponse.json();

        if (passwordsData.output && !passwordsData.output.includes("Exception")) {
          const credentialsSection = `\n\n## Available Credentials\n${passwordsData.output}`;
          const updatedPrompt = generateSystemPrompt(state.enabledServices) + credentialsSection;
          updateState({ systemPrompt: updatedPrompt });
          addTraceEntry("text", "Credentials retrieved and added to system prompt.");
        }
      }
    } catch (error) {
      addTraceEntry(
        "error",
        `Initialization error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };

  // Run agent with streaming
  const handleRunAgent = async () => {
    if (!state.isInitialized || !state.gaesaCookie || !userPrompt.trim()) {
      return;
    }

    // Create abort controller for this request
    const controller = new AbortController();
    setAbortController(controller);

    // Add initial user message to conversation
    const initialMessage = { role: "user" as const, content: userPrompt };
    setState((prev) => ({
      ...prev,
      isRunning: true,
      shouldStop: false,
      needsUserInput: false,
      conversationMessages: [initialMessage],
    }));
    addTraceEntry("user_input", userPrompt);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.apiKey,
          "x-model-provider": state.provider,
          "x-model-name": state.modelName,
          "x-enabled-services": state.enabledServices.join(","),
        },
        body: JSON.stringify({
          messages: [initialMessage],
          systemPrompt: state.systemPrompt,
          taskId: state.taskId,
          cookie: state.gaesaCookie,
        }),
        signal: controller.signal,
      });

      // Check if it's a streaming response
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("text/event-stream")) {
        // Handle SSE stream
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || ""; // Keep incomplete event in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "trace") {
                  addTraceEntry(
                    event.entry.type,
                    event.entry.content,
                    event.entry.name,
                    event.entry.args
                  );
                } else if (event.type === "tokens") {
                  setState((prev) => ({
                    ...prev,
                    tokenUsage: {
                      inputTokens: event.inputTokens,
                      outputTokens: event.outputTokens,
                      thinkingTokens: event.thinkingTokens,
                      toolCalls: event.toolCallCount,
                    },
                  }));
                } else if (event.type === "done") {
                  if (event.completed) {
                    addTraceEntry("text", "Agent marked task as complete.");
                  } else if (event.needsUserInput) {
                    addTraceEntry("text", "Agent is waiting for additional input...");
                  }
                  setState((prev) => ({
                    ...prev,
                    isRunning: false,
                    needsUserInput: event.needsUserInput || false,
                    conversationMessages: event.messages || prev.conversationMessages,
                  }));
                } else if (event.type === "error") {
                  addTraceEntry("error", `Agent error: ${event.error}${event.details ? ` - ${event.details}` : ""}`);
                  setState((prev) => ({ ...prev, isRunning: false }));
                }
              } catch (parseError) {
                console.error("Failed to parse SSE event:", line, parseError);
              }
            }
          }
        }

        // Process any remaining buffer
        if (buffer.startsWith("data: ")) {
          try {
            const event = JSON.parse(buffer.slice(6));
            if (event.type === "done") {
              setState((prev) => ({ ...prev, isRunning: false }));
            }
          } catch {
            // Ignore incomplete final event
          }
        }

        setState((prev) => ({ ...prev, isRunning: false }));
      } else {
        // Handle non-streaming response (error case)
        const data = await response.json();
        if (data.error) {
          addTraceEntry("error", `Agent error: ${data.error}${data.details ? ` - ${data.details}` : ""}`);
        }
        setState((prev) => ({ ...prev, isRunning: false }));
      }
    } catch (error) {
      // Don't show error if it was an intentional abort
      if (error instanceof Error && error.name === "AbortError") {
        // Already handled by handleStopAgent
        return;
      }
      addTraceEntry(
        "error",
        `Agent error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      setState((prev) => ({ ...prev, isRunning: false }));
    } finally {
      setAbortController(null);
    }
  };

  // Stop agent
  const handleStopAgent = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setState((prev) => ({ ...prev, shouldStop: true, isRunning: false, needsUserInput: false }));
    addTraceEntry("text", "Agent stopped by user.");
  };

  // Clear history
  const handleClearHistory = async () => {
    setState((prev) => ({
      ...prev,
      trace: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        toolCalls: 0,
      },
      worldContext: null,
      isInitialized: false,
      gaesaCookie: null,
      needsUserInput: false,
      conversationMessages: [],
    }));
    setUserPrompt("");

    // Re-initialize
    await handleInitialize();
  };

  // Reset world state
  const handleResetWorld = async () => {
    setState((prev) => ({
      ...prev,
      trace: [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        toolCalls: 0,
      },
      worldContext: null,
      isInitialized: false,
      gaesaCookie: null,
      needsUserInput: false,
      conversationMessages: [],
    }));

    await handleInitialize();
  };

  // Load world context - gets comprehensive state from all enabled services
  const handleLoadWorldContext = async () => {
    if (!state.isInitialized || !state.gaesaCookie) return;

    setState((prev) => ({ ...prev, isLoadingWorldContext: true }));

    try {
      const response = await fetch("/api/world-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: state.taskId,
          cookie: state.gaesaCookie,
          enabledServices: state.enabledServices,
        }),
      });

      const data = await response.json();

      if (data.error) {
        setState((prev) => ({
          ...prev,
          worldContext: null,
          isLoadingWorldContext: false,
        }));
        addTraceEntry("error", `Failed to load world context: ${data.error}`);
        return;
      }

      setState((prev) => ({
        ...prev,
        worldContext: {
          profile: data.profile,
          credentials: data.credentials,
          services: data.services,
        },
        isLoadingWorldContext: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        worldContext: null,
        isLoadingWorldContext: false,
      }));
      addTraceEntry("error", `Error loading world context: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  };

  // Send additional user input (multi-turn)
  const handleSendUserInput = async (input: string) => {
    if (!state.isInitialized || !state.gaesaCookie || !input.trim()) {
      return;
    }

    // Add user message to conversation
    const newUserMessage = { role: "user" as const, content: input };
    const updatedMessages = [...state.conversationMessages, newUserMessage];

    // Create abort controller for this request
    const controller = new AbortController();
    setAbortController(controller);

    setState((prev) => ({
      ...prev,
      isRunning: true,
      shouldStop: false,
      needsUserInput: false,
      conversationMessages: updatedMessages,
    }));
    addTraceEntry("user_input", input);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": state.apiKey,
          "x-model-provider": state.provider,
          "x-model-name": state.modelName,
          "x-enabled-services": state.enabledServices.join(","),
        },
        body: JSON.stringify({
          messages: updatedMessages,
          systemPrompt: state.systemPrompt,
          taskId: state.taskId,
          cookie: state.gaesaCookie,
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type");

      if (contentType?.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                if (event.type === "trace") {
                  addTraceEntry(
                    event.entry.type,
                    event.entry.content,
                    event.entry.name,
                    event.entry.args
                  );
                } else if (event.type === "tokens") {
                  setState((prev) => ({
                    ...prev,
                    tokenUsage: {
                      inputTokens: event.inputTokens,
                      outputTokens: event.outputTokens,
                      thinkingTokens: event.thinkingTokens,
                      toolCalls: event.toolCallCount,
                    },
                  }));
                } else if (event.type === "done") {
                  if (event.completed) {
                    addTraceEntry("text", "Agent marked task as complete.");
                  } else if (event.needsUserInput) {
                    addTraceEntry("text", "Agent is waiting for additional input...");
                  }
                  setState((prev) => ({
                    ...prev,
                    isRunning: false,
                    needsUserInput: event.needsUserInput || false,
                    conversationMessages: event.messages || prev.conversationMessages,
                  }));
                } else if (event.type === "error") {
                  addTraceEntry("error", `Agent error: ${event.error}${event.details ? ` - ${event.details}` : ""}`);
                  setState((prev) => ({ ...prev, isRunning: false }));
                }
              } catch (parseError) {
                console.error("Failed to parse SSE event:", line, parseError);
              }
            }
          }
        }

        setState((prev) => ({ ...prev, isRunning: false }));
      } else {
        const data = await response.json();
        if (data.error) {
          addTraceEntry("error", `Agent error: ${data.error}${data.details ? ` - ${data.details}` : ""}`);
        }
        setState((prev) => ({ ...prev, isRunning: false }));
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      addTraceEntry(
        "error",
        `Agent error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      setState((prev) => ({ ...prev, isRunning: false }));
    } finally {
      setAbortController(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <LeftSidebar
        enabledServices={state.enabledServices}
        onServicesChange={(services) => updateState({
          enabledServices: services,
          systemPrompt: generateSystemPrompt(services),
        })}
        onResetWorld={handleResetWorld}
        onShowInfo={() => setInfoOpen(true)}
        isInitialized={state.isInitialized}
      />

      <CenterPanel
        provider={state.provider}
        onProviderChange={(provider) => updateState({ provider })}
        modelName={state.modelName}
        onModelNameChange={(name) => updateState({ modelName: name })}
        apiKey={state.apiKey}
        onApiKeyChange={(key) => updateState({ apiKey: key })}
        taskId={state.taskId}
        onTaskIdChange={(id) => updateState({ taskId: id })}
        enabledServices={state.enabledServices}
        systemPrompt={state.systemPrompt}
        onSystemPromptChange={(prompt) => updateState({ systemPrompt: prompt })}
        userPrompt={userPrompt}
        onUserPromptChange={setUserPrompt}
        worldContext={state.worldContext}
        isLoadingWorldContext={state.isLoadingWorldContext}
        onLoadWorldContext={handleLoadWorldContext}
        isInitialized={state.isInitialized}
        isRunning={state.isRunning}
        onInitialize={handleInitialize}
        onRunAgent={handleRunAgent}
        onStopAgent={handleStopAgent}
        onClearHistory={handleClearHistory}
      />

      <RightPanel
        trace={state.trace}
        tokenUsage={state.tokenUsage}
        isRunning={state.isRunning}
        needsUserInput={state.needsUserInput}
        onSendUserInput={handleSendUserInput}
      />

      {/* Info Dialog */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AppWorld Agent Playground</DialogTitle>
            <DialogDescription>
              Test AI agents against simulated services
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              <div className="rounded-md border bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">
                  Contact <span className="font-medium text-foreground">Omkar Savant</span> (osavant@) with any questions/suggestions.
                </p>
              </div>

              <div>
                <h3 className="font-semibold">Available Services</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {services.map((s) => (
                    <li key={s.name}>
                      <span className="font-medium text-foreground">{s.displayName}</span>: {s.description}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-semibold">How to Use</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                  <li>Select a provider (Gemini, Anthropic, or OpenAI) and enter your API key</li>
                  <li>Enter the model name (e.g., gemini-2.0-flash, claude-sonnet-4-20250514, gpt-4o)</li>
                  <li>Select which services the agent can access</li>
                  <li>Click &quot;Initialize State&quot; to set up the world</li>
                  <li>Enter a task in the User Prompt</li>
                  <li>Click &quot;Run Agent&quot; to start</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold">Supported Providers</h3>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li><span className="font-medium text-foreground">Gemini</span>: gemini-3-flash-preview, gemini-2.0-flash, etc.</li>
                  <li><span className="font-medium text-foreground">Anthropic</span>: claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, etc.</li>
                  <li><span className="font-medium text-foreground">OpenAI</span>: gpt-4o, gpt-4-turbo, o1-preview, etc.</li>
                </ul>
              </div>

            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
