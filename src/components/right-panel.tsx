"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
    <div className="flex h-full w-[420px] min-w-[380px] flex-col border-l bg-card">
      {/* Header with token counters - compact */}
      <div className="border-b p-3">
        <h2 className="mb-2 text-base font-semibold">Agent Trace Log (Live)</h2>
        <div className="grid grid-cols-4 gap-1 text-xs">
          <div className="flex flex-col rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground text-[10px]">Input Tokens</span>
            <span className="font-mono">{tokenUsage.inputTokens.toLocaleString()}</span>
          </div>
          <div className="flex flex-col rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground text-[10px]">Output Tokens</span>
            <span className="font-mono">{tokenUsage.outputTokens.toLocaleString()}</span>
          </div>
          <div className="flex flex-col rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground text-[10px]">Thinking Tokens</span>
            <span className="font-mono">{tokenUsage.thinkingTokens.toLocaleString()}</span>
          </div>
          <div className="flex flex-col rounded bg-muted/50 px-2 py-1">
            <span className="text-muted-foreground text-[10px]">Tool Calls</span>
            <span className="font-mono">{tokenUsage.toolCalls}</span>
          </div>
        </div>
        <div className="mt-1 flex justify-between rounded bg-primary/10 px-2 py-1 text-xs">
          <span className="text-muted-foreground">Total Tokens:</span>
          <span className="font-mono font-semibold">{totalTokens.toLocaleString()}</span>
        </div>
      </div>

      {/* Trace log */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-2 p-3">
          {trace.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Agent trace will appear here...
            </div>
          ) : (
            trace.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border bg-background p-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <Badge variant={getBadgeVariant(entry.type)} className="text-xs">
                    {getTypeLabel(entry.type)}
                    {entry.name && `: ${entry.name}`}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-tight">
                  {entry.content}
                </pre>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Bottom controls - compact */}
      <div className="border-t p-2">
        <div className="flex gap-2">
          <Input
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add'l user input..."
            disabled={!isRunning}
            className="h-8 text-sm"
          />
          <Button
            size="icon"
            className="h-8 w-8"
            onClick={handleSend}
            disabled={!isRunning || !userInput.trim()}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full h-7 text-xs"
          onClick={copyTrace}
          disabled={trace.length === 0}
        >
          {copied ? (
            <>
              <Check className="mr-1 h-3 w-3" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-1 h-3 w-3" />
              Copy Trace
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
