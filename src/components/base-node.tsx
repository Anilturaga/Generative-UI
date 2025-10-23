import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BaseNodeProps {
  children: ReactNode;
  className?: string;
}

export function BaseNode({ children, className }: BaseNodeProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export interface BaseNodeContentProps {
  children: ReactNode;
  className?: string;
}

export function BaseNodeContent({ children, className }: BaseNodeContentProps) {
  return (
    <div className={cn("p-4", className)}>
      {children}
    </div>
  );
}

