"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { services } from "@/lib/services";
import { Info, RotateCcw } from "lucide-react";

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
            <h3 className="text-sm font-medium">Services</h3>
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

      <div className="space-y-2 p-4">
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
