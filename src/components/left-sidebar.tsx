"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { services } from "@/lib/services";
import { Info, RotateCcw, ExternalLink, Server, Search, BookOpen } from "lucide-react";

interface LeftSidebarProps {
  enabledServices: string[];
  onServicesChange: (services: string[]) => void;
  onResetWorld: () => void;
  onShowInfo: () => void;
  isInitialized: boolean;
}

export function LeftSidebar({
  enabledServices,
  onServicesChange,
  onResetWorld,
  onShowInfo,
  isInitialized,
}: LeftSidebarProps) {
  const toggleService = (serviceName: string) => {
    if (enabledServices.includes(serviceName)) {
      onServicesChange(enabledServices.filter((s) => s !== serviceName));
    } else {
      onServicesChange([...enabledServices, serviceName]);
    }
  };

  const selectAll = () => {
    onServicesChange(services.map((s) => s.name));
  };

  const selectNone = () => {
    onServicesChange([]);
  };

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="p-4">
        <h2 className="text-lg font-semibold">Agents Playground</h2>
      </div>

      <Separator />

      <div className="p-4">
        <div className="rounded-lg border bg-muted/50 p-3">
          <div className="font-medium">General Agent</div>
          <div className="text-xs text-muted-foreground">All tools available</div>
        </div>
      </div>

      <Separator />

      <div className="flex-1 overflow-hidden">
        <div className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Services Exposed</h3>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectAll}>
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={selectNone}>
                None
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="h-[calc(100%-8rem)]">
          <div className="space-y-2 px-4 pb-4">
            {services.map((service) => (
              <div key={service.name} className="flex items-center space-x-2">
                <Checkbox
                  id={service.name}
                  checked={enabledServices.includes(service.name)}
                  onCheckedChange={() => toggleService(service.name)}
                />
                <Label
                  htmlFor={service.name}
                  className="cursor-pointer text-sm font-normal"
                >
                  {service.displayName}
                </Label>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      {/* AppWorld Resources */}
      <div className="space-y-2 p-4">
        <div className="mb-3">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            AppWorld Resources
          </h3>
          <div className="space-y-1">
            <a
              href="https://appworld.dev/task-explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Search className="h-4 w-4" />
              Task Explorer
              <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
            </a>
            <a
              href="https://appworld.dev/api-explorer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              API Explorer
              <ExternalLink className="ml-auto h-3 w-3 opacity-50" />
            </a>
          </div>
        </div>

        <Separator />

        {/* Backend Status */}
        <div className="rounded-md border border-green-500/30 bg-green-500/10 p-2">
          <div className="flex items-center gap-2 text-xs">
            <Server className="h-3 w-3 text-green-500" />
            <span className="font-medium text-green-500">Live Backend</span>
          </div>
          <a
            href="https://appworld-api-838155728558.us-central1.run.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="https://appworld-api-838155728558.us-central1.run.app/"
          >
            appworld-api-...run.app
            <ExternalLink className="ml-1 inline h-2.5 w-2.5" />
          </a>
        </div>

        <Separator />

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onShowInfo}
        >
          <Info className="mr-2 h-4 w-4" />
          Info & Documentation
        </Button>

        <Button
          variant="destructive"
          size="sm"
          className="w-full justify-start"
          onClick={onResetWorld}
          disabled={!isInitialized}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset World State
        </Button>
      </div>
    </div>
  );
}
