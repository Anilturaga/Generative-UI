import * as React from "react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className={cn("relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl border")}> 
        {title ? <h2 className="text-lg font-semibold mb-1">{title}</h2> : null}
        {description ? <p className="text-sm text-stone-600 mb-4">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}


