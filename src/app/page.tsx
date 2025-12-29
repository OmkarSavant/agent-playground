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
import { services, defaultAgentPreset } from "@/lib/services";

export default function Home() {
  const [state, setState] = useState<PlaygroundState>(defaultState);
  const [infoOpen, setInfoOpen] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");

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

      // Store cookie and update state
      setState((prev) => ({
        ...prev,
        gaesaCookie: data.cookie || null,
        isInitialized: true,
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
          const updatedPrompt = defaultAgentPreset.systemPrompt + credentialsSection;
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

  // Run agent
  const handleRunAgent = async () => {
    if (!state.isInitialized || !state.gaesaCookie || !userPrompt.trim()) {
      return;
    }

    setState((prev) => ({ ...prev, isRunning: true, shouldStop: false }));
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
          messages: [{ role: "user", content: userPrompt }],
          systemPrompt: state.systemPrompt,
          taskId: state.taskId,
          cookie: state.gaesaCookie,
        }),
      });

      const data = await response.json();

      if (data.error) {
        addTraceEntry("error", `Agent error: ${data.error}${data.details ? ` - ${data.details}` : ""}`);
        setState((prev) => ({ ...prev, isRunning: false }));
        return;
      }

      // Add trace entries from response
      if (data.trace) {
        for (const entry of data.trace) {
          addTraceEntry(entry.type, entry.content, entry.name, entry.args);
        }
      }

      // Update token usage
      setState((prev) => ({
        ...prev,
        tokenUsage: {
          inputTokens: prev.tokenUsage.inputTokens + (data.inputTokens || 0),
          outputTokens: prev.tokenUsage.outputTokens + (data.outputTokens || 0),
          thinkingTokens: prev.tokenUsage.thinkingTokens + (data.thinkingTokens || 0),
          toolCalls: prev.tokenUsage.toolCalls + (data.toolCallCount || 0),
        },
        isRunning: false,
      }));

      if (data.completed) {
        addTraceEntry("text", "Agent marked task as complete.");
      } else if (data.needsUserInput) {
        addTraceEntry("text", "Agent is waiting for additional input...");
        setState((prev) => ({ ...prev, isRunning: true }));
      }
    } catch (error) {
      addTraceEntry(
        "error",
        `Agent error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      setState((prev) => ({ ...prev, isRunning: false }));
    }
  };

  // Stop agent
  const handleStopAgent = () => {
    setState((prev) => ({ ...prev, shouldStop: true, isRunning: false }));
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
    }));

    await handleInitialize();
  };

  // Load world context - gets profile info from supervisor
  const handleLoadWorldContext = async () => {
    if (!state.isInitialized || !state.gaesaCookie) return;

    setState((prev) => ({ ...prev, isLoadingWorldContext: true }));

    try {
      const response = await fetch("/api/appworld", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          task_id: state.taskId,
          code: "print(apis.supervisor.show_profile())",
          cookie: state.gaesaCookie,
        }),
      });

      const data = await response.json();

      setState((prev) => ({
        ...prev,
        worldContext: data.output && !data.output.includes("Exception")
          ? data.output
          : "Could not load profile. Use supervisor_show_profile tool to explore.",
        isLoadingWorldContext: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        worldContext: `Error loading: ${error instanceof Error ? error.message : "Unknown"}`,
        isLoadingWorldContext: false,
      }));
    }
  };

  // Send additional user input (multi-turn)
  const handleSendUserInput = (input: string) => {
    addTraceEntry("user_input", input);
    // In a full implementation, this would continue the agent loop
    // For now, we just log it
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <LeftSidebar
        enabledServices={state.enabledServices}
        onServicesChange={(services) => updateState({ enabledServices: services })}
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
                  <li><span className="font-medium text-foreground">Gemini</span>: gemini-2.0-flash, gemini-1.5-pro, etc.</li>
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
