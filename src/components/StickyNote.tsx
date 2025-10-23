import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type StickyNoteData = {
  text: string;
  rotation?: number;
};

export const StickyNote = memo(({ data }: NodeProps) => {
  const { text, rotation } = (data as StickyNoteData) || {};
  return (
    <div
      className="sticky-note"
      style={{
        '--rotate': `${rotation || 0}deg`,
      } as React.CSSProperties}
    >
      {text}
    </div>
  );
});

StickyNote.displayName = "StickyNote";

