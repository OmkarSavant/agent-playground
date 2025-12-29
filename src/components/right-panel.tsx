"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TraceEntry, TokenUsage } from "@/lib/store";
import { Copy, Send, Check } from "lucide-react";

interface RightPanelProps {
  trace: TraceEntry[];
  tokenUsage: TokenUsage;
  isRunning: boolean;
  onSendUserInput: (input: string) => void;
}

export function RightPanel({
  trace,
  tokenUsage,
  isRunning,
  onSendUserInput,
}: RightPanelProps) {
  const [userInput, setUserInput] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when trace updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [trace]);

  const handleSend = () => {
    if (userInput.trim()) {
      onSendUserInput(userInput);
      setUserInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyTrace = async () => {
    const traceJson = JSON.stringify(
      trace.map((entry) => ({
        type: entry.type,
        timestamp: entry.timestamp.toISOString(),
        content: entry.content,
        name: entry.name,
        args: entry.args,
      })),
      null,
      2
    );

    await navigator.clipboard.writeText(traceJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getBadgeVariant = (type: TraceEntry["type"]) => {
    switch (type) {
      case "tool_call":
        return "blue";
      case "tool_result":
        return "secondary";
      case "text":
        return "green";
      case "user_input":
        return "yellow";
      case "error":
        return "red";
      default:
        return "secondary";
    }
  };

  const getTypeLabel = (type: TraceEntry["type"]) => {
    switch (type) {
      case "tool_call":
        return "Tool Call";
      case "tool_result":
        return "Result";
      case "text":
        return "Text";
      case "user_input":
        return "User";
      case "error":
        return "Error";
      default:
        return type;
    }
  };

  const totalTokens =
    tokenUsage.inputTokens + tokenUsage.outputTokens + tokenUsage.thinkingTokens;

  return (
    <div className="flex h-full w-96 flex-col border-l bg-card">
      {/* Header with token counters */}
      <div className="border-b p-4">
        <h2 className="mb-3 text-lg font-semibold">Agent Trace Log (Live)</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground">Input:</span>
            <span className="font-mono">{tokenUsage.inputTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground">Output:</span>
            <span className="font-mono">{tokenUsage.outputTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground">Thinking:</span>
            <span className="font-mono">{tokenUsage.thinkingTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground">Tools:</span>
            <span className="font-mono">{tokenUsage.toolCalls}</span>
          </div>
        </div>
        <div className="mt-2 flex justify-between rounded bg-primary/10 px-2 py-1 text-xs">
          <span className="text-muted-foreground">Total Tokens:</span>
          <span className="font-mono font-semibold">{totalTokens.toLocaleString()}</span>
        </div>
      </div>

      {/* Trace log */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-3 p-4">
          {trace.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Agent trace will appear here...
            </div>
          ) : (
            trace.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-background p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant={getBadgeVariant(entry.type)}>
                    {getTypeLabel(entry.type)}
                    {entry.name && `: ${entry.name}`}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {entry.content}
                </pre>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* User input for multi-turn */}
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add'l user input..."
            disabled={!isRunning}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!isRunning || !userInput.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Copy trace button */}
      <div className="p-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={copyTrace}
          disabled={trace.length === 0}
        >
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              Copy Trace
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
