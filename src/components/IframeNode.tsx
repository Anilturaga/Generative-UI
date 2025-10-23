import { memo, useCallback, useState } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { BaseNode } from "./base-node";
import { Button } from "./ui/button";
import { X } from "lucide-react";

export type IframeNodeData = {
  url?: string;
  html?: string;
  title?: string;
  onDelete?: (id: string) => void;
  registerIframeRef?: (id: string, el: HTMLIFrameElement | null) => void;
};

export const IframeNode = memo(({ id, data, selected, dragging }: NodeProps) => {
  const { url, html, title, onDelete } = (data as IframeNodeData) || {};
  const [isResizing, setIsResizing] = useState(false);

  const handleDelete = useCallback(() => {
    onDelete?.(id);
  }, [id, onDelete]);

  return (
    <>
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={300}
        minHeight={200}
        lineClassName="!border-transparent !border-6"
        handleClassName="!h-3 !w-3 !bg-transparent !border-transparent"
        onResizeStart={() => setIsResizing(true)}
        onResizeEnd={() => setIsResizing(false)}
      />
      <BaseNode className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
          <div className="text-sm font-medium truncate flex-1 mr-2 break-words">
            {title || (html ? "Generated HTML" : url)}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleDelete}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 relative">
          {html ? (
            <iframe
              ref={(el) => (data as IframeNodeData)?.registerIframeRef?.(id, el)}
              srcDoc={html}
              className="absolute inset-0 w-full h-full border-0"
              title={`iframe-${id}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{ pointerEvents: dragging || isResizing ? 'none' : 'auto' }}
            />
          ) : (
            <iframe
              ref={(el) => (data as IframeNodeData)?.registerIframeRef?.(id, el)}
              src={url}
              className="absolute inset-0 w-full h-full border-0"
              title={`iframe-${id}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              style={{ pointerEvents: dragging || isResizing ? 'none' : 'auto' }}
            />
          )}
        </div>
      </BaseNode>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
});

IframeNode.displayName = "IframeNode";

