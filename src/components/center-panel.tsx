"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { services } from "@/lib/services";
import { ModelProvider, WorldContext } from "@/lib/store";
import {
  Play,
  Square,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";

// Helper component for world context sections
function WorldContextSection({
  title,
  children,
  defaultOpen = false,
  badge,
  error,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  error?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border bg-muted/50 px-3 py-2 hover:bg-muted/70">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {badge && (
            <Badge variant="secondary" className="text-xs">
              {badge}
            </Badge>
          )}
          {error && (
            <Badge variant="red" className="text-xs">
              Error
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 rounded-md border bg-muted/30 p-3">
        {error ? (
          <div className="text-xs text-red-500">{error}</div>
        ) : (
          children
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface CenterPanelProps {
  provider: ModelProvider;
  onProviderChange: (provider: ModelProvider) => void;
  modelName: string;
  onModelNameChange: (name: string) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  taskId: string;
  onTaskIdChange: (id: string) => void;
  enabledServices: string[];
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  userPrompt: string;
  onUserPromptChange: (prompt: string) => void;
  worldContext: WorldContext | null;
  isLoadingWorldContext: boolean;
  onLoadWorldContext: () => void;
  isInitialized: boolean;
  isRunning: boolean;
  onInitialize: () => void;
  onRunAgent: () => void;
  onStopAgent: () => void;
  onClearHistory: () => void;
}

export function CenterPanel({
  provider,
  onProviderChange,
  modelName,
  onModelNameChange,
  apiKey,
  onApiKeyChange,
  taskId,
  onTaskIdChange,
  enabledServices,
  systemPrompt,
  onSystemPromptChange,
  userPrompt,
  onUserPromptChange,
  worldContext,
  isLoadingWorldContext,
  onLoadWorldContext,
  isInitialized,
  isRunning,
  onInitialize,
  onRunAgent,
  onStopAgent,
  onClearHistory,
}: CenterPanelProps) {
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [isWorldContextOpen, setIsWorldContextOpen] = useState(false);

  const enabledServiceNames = services
    .filter((s) => enabledServices.includes(s.name))
    .map((s) => s.displayName);

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 border-b bg-card p-4">
        <div className="flex items-center gap-2">
          <Label className="whitespace-nowrap">Provider</Label>
          <Select value={provider} onValueChange={(v) => onProviderChange(v as ModelProvider)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Gemini</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="model" className="whitespace-nowrap">
            Model
          </Label>
          <Input
            id="model"
            value={modelName}
            onChange={(e) => onModelNameChange(e.target.value)}
            className="w-48"
            placeholder={provider === "gemini" ? "gemini-3-flash-preview" : provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o"}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="apiKey" className="whitespace-nowrap">
            API Key
          </Label>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            className="w-64"
            placeholder="Enter your API key"
          />
        </div>
      </div>

      {/* Main content */}
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          {/* Agent Title & Initialize */}
          <div>
            <h1 className="text-2xl font-bold">General Agent</h1>
            <div className="mt-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="taskId" className="whitespace-nowrap text-sm text-muted-foreground">
                  Task ID
                </Label>
                <Input
                  id="taskId"
                  value={taskId}
                  onChange={(e) => onTaskIdChange(e.target.value)}
                  className="w-32"
                  placeholder="b0a8eae_1"
                />
              </div>
              <Button
                variant="success"
                size="sm"
                onClick={onInitialize}
                disabled={isRunning || !apiKey}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Initialize State
              </Button>
              {isInitialized && (
                <Badge variant="green">Initialized</Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* Available Tools */}
          <div>
            <h3 className="mb-2 text-sm font-medium">Available Tools</h3>
            <div className="flex flex-wrap gap-1">
              {enabledServiceNames.length > 0 ? (
                enabledServiceNames.map((name) => (
                  <Badge key={name} variant="secondary">
                    {name}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No services enabled</span>
              )}
            </div>
          </div>

          <Separator />

          {/* World Context (Lazy) */}
          <Collapsible open={isWorldContextOpen} onOpenChange={setIsWorldContextOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <h3 className="text-sm font-medium">World Context</h3>
              {isWorldContextOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {worldContext ? (
                <div className="space-y-3">
                  {/* User Profile */}
                  {worldContext.profile && (
                    <WorldContextSection title="User Profile" defaultOpen>
                      <pre className="whitespace-pre-wrap text-xs">
                        {JSON.stringify(worldContext.profile, null, 2)}
                      </pre>
                    </WorldContextSection>
                  )}

                  {/* Service Data */}
                  {worldContext.services.map((service) => (
                    <WorldContextSection
                      key={service.name}
                      title={service.displayName}
                      badge={Object.keys(service.data).length > 0 ? undefined : "No data"}
                      error={service.error}
                    >
                      {Object.entries(service.data).map(([key, value]) => (
                        <div key={key} className="mb-2 last:mb-0">
                          <div className="text-xs font-medium text-muted-foreground mb-1 capitalize">
                            {key.replace(/([A-Z])/g, " $1").trim()}
                          </div>
                          <pre className="whitespace-pre-wrap text-xs bg-background/50 rounded p-2 max-h-32 overflow-auto">
                            {typeof value === "string"
                              ? value
                              : JSON.stringify(value, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </WorldContextSection>
                  ))}

                  {/* Reload button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLoadWorldContext}
                    disabled={isLoadingWorldContext}
                    className="w-full"
                  >
                    {isLoadingWorldContext ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Refreshing...
                      </>
                    ) : (
                      "Refresh World State"
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLoadWorldContext}
                  disabled={!isInitialized || isLoadingWorldContext}
                >
                  {isLoadingWorldContext ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Explore World State"
                  )}
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* System Prompt */}
          <Collapsible open={isSystemPromptOpen} onOpenChange={setIsSystemPromptOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <h3 className="text-sm font-medium">System Prompt</h3>
              {isSystemPromptOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <Textarea
                value={systemPrompt}
                onChange={(e) => onSystemPromptChange(e.target.value)}
                className="min-h-[200px] font-mono text-sm"
                placeholder="Enter system prompt..."
              />
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          {/* User Prompt */}
          <div>
            <h3 className="mb-2 text-sm font-medium">User Prompt</h3>
            <Textarea
              value={userPrompt}
              onChange={(e) => onUserPromptChange(e.target.value)}
              className="min-h-[120px]"
              placeholder="Enter your task or instruction for the agent..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="success"
              onClick={onRunAgent}
              disabled={!isInitialized || isRunning || !userPrompt.trim()}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Agent
                </>
              )}
            </Button>

            <Button
              variant="destructive"
              onClick={onStopAgent}
              disabled={!isRunning}
            >
              <Square className="mr-2 h-4 w-4" />
              Stop Agent
            </Button>

            <Button
              variant="warning"
              onClick={onClearHistory}
              disabled={isRunning}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear History + New Agent
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
