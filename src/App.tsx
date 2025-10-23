import { useState, useCallback, useMemo, useRef, useEffect, KeyboardEvent } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { IframeNode } from "./components/IframeNode";
import { StickyNote } from "./components/StickyNote";
import { Input } from "./components/ui/input";
import { ArrowUp, ArrowDown, Wrench, Settings, Sparkles } from "lucide-react";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import { runAgentStream, buildAgentSystemPrompt, type AgentContext, type CreateNewWindowResult, type DomReplaceResult, type DomMutation } from "@/lib/ai";
import { type ModelMessage } from "ai";
import { getApiKey, getSelectedProvider, type AIProvider, deleteApiKey, isAuthError } from "@/lib/utils";

// Move nodeTypes outside component to prevent recreation
const nodeTypes = {
  iframe: IframeNode,
  stickyNote: StickyNote,
} as const;

// Initial sticky notes like in the image
const initialNodes: Node[] = [
  {
    id: "sticky-1",
    type: "stickyNote",
    position: { x: 40, y: 30 },
    data: { text: "Note to self:\nTrust the process", rotation: -2 },
    draggable: false,
    selectable: false,
    style: { width: 180, height: 180 },
  },
  {
    id: "sticky-2",
    type: "stickyNote",
    position: { x: 260, y: 40 },
    data: { text: "You've got this!", rotation: 3 },
    draggable: false,
    selectable: false,
    style: { width: 180, height: 140 },
  },
  {
    id: "sticky-3",
    type: "stickyNote",
    position: { x: 80, y: 260 },
    data: { text: "Keep thinking", rotation: -1 },
    draggable: false,
    selectable: false,
    style: { width: 160, height: 140 },
  },
];

// Example helper prompts shown before any user message
const EXAMPLE_PROMPTS: { title: string; description: string }[] = [
  {
    title: "Tic-Tac-Toe with AI",
    description: "Create a Tic-Tac-Toe game where I will play against you. You must be able to track the game state and make the best possible move.",
  },
  {
    title: "Shakespeare's Desktop",
    description: "Imagine William Shakespeare's Desktop.",
  },
  {
    title: "Free form TODO List app",
    description: "Create a todo list application where I can write a free form text and it should be converted to one or more TODO items with appropriate tags and metadata(due date, priority, etc.). You must be able to track the TODO list state and update the UI accordingly.",
  },
];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [rightText, setRightText] = useState<string>("");
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  const [showApiDialog, setShowApiDialog] = useState(false);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<ModelMessage[]>([]);
  const historyRef = useRef<ModelMessage[]>([]);
  useEffect(() => { historyRef.current = history; }, [history]);
  const [tokenUsage, setTokenUsage] = useState<{ input: number | null; output: number | null } | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [responsesCollapsed, setResponsesCollapsed] = useState(false);

  // removed dragging logic; simple collapse/expand only

  // Auto-scroll to end while streaming
  useEffect(() => {
    if (!isLoading) return;
    const el = rightPanelRef.current;
    if (!el || responsesCollapsed) return;
    try {
      el.scrollTo({ top: el.scrollHeight });
    } catch {}
  }, [rightText, isLoading, responsesCollapsed]);

  // no manual scroll-to-end indicators needed

  const toToolMessageFromResult = useCallback((toolResult: any): ModelMessage => ({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: toolResult.toolCallId, toolName: toolResult.toolName, result: toolResult.result } as any],
  }), []);

  const toToolCallAssistantMessage = useCallback((toolName: string, toolCallId: string, argsObj: any): ModelMessage => ({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName, input: argsObj || {} } as any],
  }), []);

  // Mappings for window management
  const nameToNodeIdRef = useRef<Map<string, string>>(new Map());
  const nodeIdToNameRef = useRef<Map<string, string>>(new Map());
  const windowIdToNodeIdRef = useRef<Map<string, string>>(new Map());
  const nodeIdToWindowIdRef = useRef<Map<string, string>>(new Map());
  const nodeIdToIframeRef = useRef<Map<string, HTMLIFrameElement | null>>(new Map());
  // Provisional windows created during streaming create_new_window (keyed by toolCallId)
  const streamingCreateRef = useRef<Map<string, { nodeId: string; name?: string }>>(new Map());
  // Track live dom_replace sessions by toolCallId (for incremental per-item application)
  const streamingDomRef = useRef<Map<string, { windowId?: string; appliedCount: number; baseHtml?: string; currentHtml?: string }>>(new Map());
  // Track set_window_html streaming sessions by toolCallId
  const streamingSetHtmlRef = useRef<Map<string, { windowId?: string; argsAccum?: string }>>(new Map());
  // Used to map a provisional name (when known) to the provisional node id for potential reuse/cleanup
  const provisionalNameToNodeIdRef = useRef<Map<string, string>>(new Map());
  // Sequence used to cascade position offsets for new windows
  const createSequenceRef = useRef<number>(0);

  const availableWindowIds = useMemo(() => Array.from(windowIdToNodeIdRef.current.keys()), [nodes.length]);

  const hasAnyUserMessage = useMemo(
    () => history.some((m) => (m as any).role === 'user') || !!lastUserMessage,
    [history, lastUserMessage]
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      const name = nodeIdToNameRef.current.get(nodeId);
      if (name) { nameToNodeIdRef.current.delete(name); nodeIdToNameRef.current.delete(nodeId); }
      const winId = nodeIdToWindowIdRef.current.get(nodeId);
      if (winId) { windowIdToNodeIdRef.current.delete(winId); nodeIdToWindowIdRef.current.delete(nodeId); }
      nodeIdToIframeRef.current.delete(nodeId);
      setNodes((nds) => nds.filter((node) => node.id !== nodeId));
      setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    },
    [setNodes, setEdges]
  );

  // Memoize nodeData to prevent unnecessary re-renders
  const nodeData = useMemo(
    () => ({
      onDelete: handleDelete,
      registerIframeRef: (id: string, el: HTMLIFrameElement | null) => {
        nodeIdToIframeRef.current.set(id, el);
      },
    }),
    [handleDelete]
  );

  // Tool handlers for the agent
  const createNewWindow = useCallback(async (name: string, html: string): Promise<CreateNewWindowResult> => {
    try { console.log('[GENUI][tool] createNewWindow', { name, htmlPreview: html?.slice?.(0, 160) }); } catch {}
    // Ensure unique name
    let finalName = name.trim();
    let suffix = 2;
    while (nameToNodeIdRef.current.has(finalName)) {
      finalName = `${name} (${suffix++})`;
    }
    const genWindowId = (): string => `w${Math.random().toString(36).slice(2, 8)}`;
    let windowId = genWindowId();
    while (windowIdToNodeIdRef.current.has(windowId)) windowId = genWindowId();
    // If a provisional node already exists for this name, reuse it
    const provisionalId = provisionalNameToNodeIdRef.current.get(name) || null;
    const normalizedHtml = decodePossibleEscapes(html);
    if (provisionalId) {
      nameToNodeIdRef.current.set(finalName, provisionalId);
      nodeIdToNameRef.current.set(provisionalId, finalName);
      windowIdToNodeIdRef.current.set(windowId, provisionalId);
      nodeIdToWindowIdRef.current.set(provisionalId, windowId);
      setNodes((nds) => {
        const maxZIndex = nds.reduce((max, n) => Math.max(max, (n as any).zIndex || 0), 0);
        return nds.map((n) => {
          if (n.id !== provisionalId) return { ...n, selected: false } as Node;
          return {
            ...n,
            selected: true,
            zIndex: Math.max(maxZIndex + 1, (n as any).zIndex || 0),
            data: { ...(n.data as any), html: normalizedHtml, title: finalName },
          } as Node;
        });
      });
      provisionalNameToNodeIdRef.current.delete(name);
      setFocusedWindowId(windowId);
      try {
        setTimeout(() => {
          const iframeEl = nodeIdToIframeRef.current.get(provisionalId);
          try { iframeEl?.focus?.(); } catch {}
          try { iframeEl?.contentWindow?.focus?.(); } catch {}
        }, 0);
      } catch {}
      const renamed = finalName !== name;
      const res: CreateNewWindowResult = { status: renamed ? 'renamed' : 'created', name, finalName, nodeId: provisionalId, windowId };
      return res;
    }

    const computeResponsiveRect = (offsetIndex: number): { x: number; y: number; width: number; height: number } => {
      const vw = Math.max(320, Math.min(window.innerWidth || 1280, 3840));
      const vh = Math.max(320, Math.min(window.innerHeight || 720, 2160));
      const isMobile = vw < 640; // tailwind sm
      const targetAspect = (isMobile && vh >= vw) ? 3 / 4 : 16 / 10; // prefer slight portrait on mobile
      const marginX = Math.round(vw * (isMobile ? 0.04 : 0.05));
      const marginY = Math.round(vh * (isMobile ? 0.05 : 0.08));
      const maxW = Math.max(280, vw - marginX * 2);
      const maxH = Math.max(220, vh - marginY * 2);
      // Reduce size on large screens; on mobile, use near-full width
      let widthFraction = isMobile ? 0.96 : (vw >= 1920 ? 0.5 : (vw >= 1440 ? 0.6 : 0.66));
      const baseW = Math.min(maxW, Math.round(widthFraction * vw));
      let width = baseW;
      let height = Math.round(width / targetAspect);
      if (height > maxH) {
        height = maxH;
        width = Math.round(height * targetAspect);
      }
      // Start around center, but nudge a bit above (more on mobile)
      const nudgeUp = Math.round(vh * (isMobile ? 0.12 : 0.06));
      let x = Math.round((vw - width) / 2);
      let y = Math.round((vh - height) / 2) - nudgeUp;
      // Cascade offset so new windows don't stack perfectly
      const cascadeMax = 6;
      const stepX = Math.round(Math.min(40, vw * 0.03));
      const stepY = Math.round(Math.min(32, vh * 0.03));
      const i = Math.max(0, offsetIndex % cascadeMax);
      x += i * stepX;
      y += i * stepY;
      // Clamp inside margins
      x = Math.max(marginX, Math.min(x, vw - width - marginX));
      y = Math.max(marginY, Math.min(y, vh - height - marginY));
      return { x, y, width, height };
    };

    const rect = computeResponsiveRect(createSequenceRef.current);
    createSequenceRef.current = (createSequenceRef.current + 1) >>> 0;
    const newNode: Node = {
      id: `iframe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "iframe",
      position: { x: rect.x, y: rect.y },
      data: { html: normalizedHtml, title: finalName, ...nodeData },
      style: { width: rect.width, height: rect.height },
      zIndex: 1000,
    };
    nameToNodeIdRef.current.set(finalName, newNode.id);
    nodeIdToNameRef.current.set(newNode.id, finalName);
    windowIdToNodeIdRef.current.set(windowId, newNode.id);
    nodeIdToWindowIdRef.current.set(newNode.id, windowId);
    setNodes((nds) => {
      const maxZIndex = nds.reduce((max, n) => Math.max(max, (n as any).zIndex || 0), 0);
      const deselected = nds.map((n) => ({ ...n, selected: false }));
      const nodeWithFocus: Node = { ...newNode, zIndex: Math.max(maxZIndex + 1, (newNode as any).zIndex || 0), selected: true } as Node;
      return [...deselected, nodeWithFocus];
    });
    setFocusedWindowId(windowId);
    try {
      // Slight delay to ensure the iframe is mounted before focusing
      setTimeout(() => {
        const iframeEl = nodeIdToIframeRef.current.get(newNode.id);
        try { iframeEl?.focus?.(); } catch {}
        try { iframeEl?.contentWindow?.focus?.(); } catch {}
      }, 0);
    } catch {}
    const renamed = finalName !== name;
    const res: CreateNewWindowResult = { status: renamed ? 'renamed' : 'created', name, finalName, nodeId: newNode.id, windowId };
    // Do not append tool messages here; SDK will return toolResults with toolCallId
    return res;
  }, [nodeData, setNodes, setFocusedWindowId]);

  const domReplace = useCallback(async (
    windowId: string,
    mutations: DomMutation[]
  ): Promise<DomReplaceResult> => {
    try { console.log('[GENUI][tool] domReplace', { windowId, mutations }); } catch {}
    const nodeId = windowIdToNodeIdRef.current.get(windowId);
    if (!nodeId) {
      const res: DomReplaceResult = { status: 'edited', windowId, html: '', totals: { totalMutations: mutations.length, totalTargets: 0, totalApplied: 0, failed: mutations.length }, details: mutations.map(m => ({ action: m.action, selector: (m as any).selector, matched: 0, applied: 0 })) } as DomReplaceResult;
      return res;
    }
    // Cancel any pending streaming preview writes to avoid a race that overwrites final state
    try {
      const queued = iframeUpdateQueueRef.current.get(nodeId);
      if (queued?.timer != null) window.clearTimeout(queued.timer);
      iframeUpdateQueueRef.current.delete(nodeId);
    } catch {}
    let details: Array<{ action: string; selector: string; matched: number; applied: number; error?: string }> = [];
    let totalTargets = 0;
    let totalApplied = 0;
    let finalHtml = '';
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const liveHtml = getLiveIframeHtml(nodeId);
      const currentHtml: string = liveHtml ?? ((n.data as any)?.html || '');
      const parser = new DOMParser();
      const doc = parser.parseFromString(currentHtml || '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>', 'text/html');

      const applyMutations = (doc: Document, muts: DomMutation[]) => {
        const localDetails: Array<{ action: string; selector: string; matched: number; applied: number; error?: string }> = [];
        for (const m of muts) {
          try {
            const list = Array.from(doc.querySelectorAll((m as any).selector || '')) as HTMLElement[];
            let appliedCount = 0;
            if (m.action === 'set_text') {
              for (const el of list) { el.textContent = m.text; appliedCount++; }
            } else if (m.action === 'set_html') {
              for (const el of list) { el.innerHTML = m.html; appliedCount++; }
            } else if (m.action === 'replace_with_html') {
              for (const el of list) {
                const tpl = doc.createElement('template');
                tpl.innerHTML = m.html;
                const frag = tpl.content.cloneNode(true);
                // replaceWith can accept multiple nodes; spread children
                el.replaceWith(...Array.from((frag as DocumentFragment).childNodes));
                appliedCount++;
              }
            } else if (m.action === 'insert_html') {
              for (const el of list) { el.insertAdjacentHTML(m.position, m.html); appliedCount++; }
            } else if (m.action === 'set_attr') {
              for (const el of list) { el.setAttribute(m.name, m.value); appliedCount++; }
            } else if (m.action === 'remove_attr') {
              for (const el of list) { el.removeAttribute(m.name); appliedCount++; }
            } else if (m.action === 'add_class') {
              for (const el of list) { el.classList.add(m.class); appliedCount++; }
            } else if (m.action === 'remove_class') {
              for (const el of list) { el.classList.remove(m.class); appliedCount++; }
            } else if (m.action === 'remove') {
              for (const el of list) { el.remove(); appliedCount++; }
            }
            totalTargets += list.length;
            totalApplied += appliedCount;
            localDetails.push({ action: m.action, selector: (m as any).selector, matched: list.length, applied: appliedCount });
          } catch (err) {
            const sel = (m as any).selector || '';
            localDetails.push({ action: m.action, selector: sel, matched: 0, applied: 0, error: String(err) });
          }
        }
        return localDetails;
      };

      const localDetails = applyMutations(doc, mutations);
      details = localDetails;
      finalHtml = '<!DOCTYPE html>' + (doc.documentElement ? doc.documentElement.outerHTML : '');
      return {
        ...n,
        data: {
          ...(n.data as any),
          html: finalHtml,
        },
      };
    }));
    const res: DomReplaceResult = {
      status: 'edited',
      windowId,
      html: finalHtml,
      totals: { totalMutations: mutations.length, totalTargets, totalApplied, failed: mutations.length - details.filter(d => d.applied > 0).length },
      details,
    };
    return res;
  }, [setNodes]);

  const updateWindowTitle = useCallback(async (
    windowId: string,
    title: string
  ): Promise<{ status: 'updated'; windowId: string; title: string }> => {
    try { console.log('[GENUI][tool] updateWindowTitle', { windowId, title }); } catch {}
    const nodeId = windowIdToNodeIdRef.current.get(windowId);
    if (!nodeId) return { status: 'updated', windowId, title };
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, data: { ...(n.data as any), title } } as Node;
    }));
    // Maintain name mapping only for display; don't rely on it for tools
    const prevName = nodeIdToNameRef.current.get(nodeId);
    if (prevName) nameToNodeIdRef.current.delete(prevName);
    nodeIdToNameRef.current.set(nodeId, title);
    nameToNodeIdRef.current.set(title, nodeId);
    return { status: 'updated', windowId, title };
  }, [setNodes]);

  const setWindowHtml = useCallback(async (
    windowId: string,
    html: string
  ): Promise<{ status: 'set'; windowId: string; htmlLength: number }> => {
    try { console.log('[GENUI][tool] setWindowHtml', { windowId, htmlPreview: html?.slice?.(0, 160) }); } catch {}
    const nodeId = windowIdToNodeIdRef.current.get(windowId);
    const normalizedHtml = decodePossibleEscapes(html);
    if (!nodeId) return { status: 'set', windowId, htmlLength: normalizedHtml.length };
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, data: { ...(n.data as any), html: normalizedHtml } } as Node;
    }));
    // Push final HTML to iframe
    try { writeIframeHtml(nodeId, normalizedHtml, false); } catch {}
    return { status: 'set', windowId, htmlLength: normalizedHtml.length };
  }, [setNodes]);

  const buildAgentContext = useCallback((): AgentContext => ({
    availableWindowIds,
    focusedWindowId,
  }), [availableWindowIds, focusedWindowId]);

  // --- Streaming helpers ---
  const healHtmlStream = useCallback((partialHTML: string): string => {
    // Minimal healer: remove incomplete trailing tag and close open tags (excluding script/style)
    const selfClosing = new Set(['img','br','hr','input','meta','link','area','base','col','embed','param','source','track','wbr']);
    const complex = new Set(['script','style']);
    let healed = partialHTML || '';
    // Drop incomplete <script/style> blocks
    for (const tag of complex) {
      const openTagRegex = new RegExp(`<${tag}[^>]*>(?:(?!<\\/${tag}>)[\\s\\S])*$`, 'i');
      const m = healed.match(openTagRegex);
      if (m) {
        healed = healed.substring(0, healed.lastIndexOf(m[0]));
      }
      const incompleteOpen = new RegExp(`<${tag}[^>]*$`, 'i');
      if (incompleteOpen.test(healed)) healed = healed.replace(incompleteOpen, '');
    }
    if (/<[^>]*$/.test(healed)) healed = healed.replace(/<[^>]*$/, '');
    const tagStack: string[] = [];
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let match;
    while ((match = tagRegex.exec(healed)) !== null) {
      const full = match[0];
      const name = match[1].toLowerCase();
      if (selfClosing.has(name) || complex.has(name)) continue;
      if (full.startsWith('</')) {
        if (tagStack[tagStack.length - 1] === name) tagStack.pop();
      } else if (!full.endsWith('/>')) {
        tagStack.push(name);
      }
    }
    if (tagStack.length) healed += tagStack.reverse().map(t => `</${t}>`).join('');
    return healed;
  }, []);

  const unescapeJsonString = (s: string): string => {
    try {
      // Keep existing backslashes to allow sequences like \n to be interpreted
      // Only escape quotes to embed into a JSON string literal
      return JSON.parse('"' + s.replace(/"/g, '\\"') + '"');
    } catch {
      return s
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  };

  // Normalize possibly JSON-escaped strings to their literal characters (e.g., \n -> newline, \" -> ")
  const decodePossibleEscapes = (value: string): string => {
    if (typeof value !== 'string') return value as unknown as string;
    if (!value.includes('\\')) return value;
    try {
      return JSON.parse('"' + value.replace(/"/g, '\\"') + '"');
    } catch {
      return value
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  };

  const extractLatestJsonStringField = (jsonLike: string, field: string): string | null => {
    const re = new RegExp(`"${field.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}"\\s*:\\s*"`, 'g');
    let m: RegExpExecArray | null = null;
    let lastIndex = -1;
    while ((m = re.exec(jsonLike)) !== null) lastIndex = m.index + m[0].length;
    if (lastIndex === -1) return null;
    // Scan until next unescaped quote
    let i = lastIndex;
    let out = '';
    let escaped = false;
    while (i < jsonLike.length) {
      const ch = jsonLike[i++];
      if (escaped) { out += '\\' + ch; escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') break;
      out += ch;
    }
    return unescapeJsonString(out);
  };

  const writeIframeHtml = (nodeId: string, html: string, isStreaming = false) => {
    const iframeEl = nodeIdToIframeRef.current.get(nodeId);
    if (!iframeEl) return;
    
    // During streaming, manipulate DOM directly to avoid full page reloads and flashing
    if (isStreaming) {
      try {
        const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
        if (!doc) return;
        
        // Parse the new HTML
        const parser = new DOMParser();
        const newDoc = parser.parseFromString(html, 'text/html');
        
        // If document is empty/uninitialized, do initial write
        if (!doc.body || doc.body.childNodes.length === 0) {
          doc.open();
          doc.write(html);
          doc.close();
          return;
        }
        
        // Update existing document without reload
        // Replace head content if it changed significantly
        if (newDoc.head && doc.head) {
          const oldHeadHtml = doc.head.innerHTML;
          const newHeadHtml = newDoc.head.innerHTML;
          if (oldHeadHtml !== newHeadHtml) {
            doc.head.innerHTML = newHeadHtml;
          }
        }
        
        // Replace body content smoothly
        if (newDoc.body && doc.body) {
          doc.body.innerHTML = newDoc.body.innerHTML;
          // Copy body attributes
          Array.from(newDoc.body.attributes).forEach(attr => {
            doc.body?.setAttribute(attr.name, attr.value);
          });
        }
        return;
      } catch (e) {
        // Fall through to srcdoc on error
        console.warn('[GENUI] DOM streaming failed, falling back to srcdoc:', e);
      }
    }
    
    // For final/complete HTML, use srcdoc (one-time reload is fine)
    try {
      (iframeEl as HTMLIFrameElement).srcdoc = html;
      return;
    } catch {}
    
    // Final fallback
    try {
      const doc = iframeEl.contentDocument || iframeEl.contentWindow?.document;
      if (!doc) return;
      doc.open();
      doc.write(html);
      doc.close();
    } catch {}
  };

  // Throttle frequent DOM updates to reduce flicker during streaming
  const iframeUpdateQueueRef = useRef<Map<string, { pendingHtml: string; timer: number | null; isStreaming: boolean }>>(new Map());
  const updateIframeThrottled = (nodeId: string, html: string, isStreaming = true, delayMs = 50) => {
    const existing = iframeUpdateQueueRef.current.get(nodeId) || { pendingHtml: '', timer: null, isStreaming: true };
    existing.pendingHtml = html;
    existing.isStreaming = isStreaming;
    if (existing.timer != null) {
      iframeUpdateQueueRef.current.set(nodeId, existing);
      return;
    }
    existing.timer = window.setTimeout(() => {
      try { writeIframeHtml(nodeId, existing.pendingHtml, existing.isStreaming); } catch {}
      if (existing.timer != null) window.clearTimeout(existing.timer);
      existing.timer = null;
    }, delayMs);
    iframeUpdateQueueRef.current.set(nodeId, existing);
  };
  // Read the current live HTML from the iframe document if available
  const getLiveIframeHtml = (nodeId: string): string | null => {
    const iframeEl = nodeIdToIframeRef.current.get(nodeId);
    const doc = iframeEl?.contentDocument || iframeEl?.contentWindow?.document;
    try {
      if (doc?.documentElement) {
        return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
      }
    } catch {}
    return null;
  };

  const ensureProvisionalCreateNode = (toolCallId: string): string => {
    const existing = streamingCreateRef.current.get(toolCallId)?.nodeId;
    if (existing) return existing;
    const computeResponsiveRect = (offsetIndex: number): { x: number; y: number; width: number; height: number } => {
      const vw = Math.max(320, Math.min(window.innerWidth || 1280, 3840));
      const vh = Math.max(320, Math.min(window.innerHeight || 720, 2160));
      const isMobile = vw < 640;
      const targetAspect = (isMobile && vh >= vw) ? 3 / 4 : 16 / 10; // prefer slight portrait on mobile
      const marginX = Math.round(vw * (isMobile ? 0.04 : 0.05));
      const marginY = Math.round(vh * (isMobile ? 0.05 : 0.08));
      const maxW = Math.max(280, vw - marginX * 2);
      const maxH = Math.max(220, vh - marginY * 2);
      let widthFraction = isMobile ? 0.96 : (vw >= 1920 ? 0.5 : (vw >= 1440 ? 0.6 : 0.66));
      const baseW = Math.min(maxW, Math.round(widthFraction * vw));
      let width = baseW;
      let height = Math.round(width / targetAspect);
      if (height > maxH) {
        height = maxH;
        width = Math.round(height * targetAspect);
      }
      const nudgeUp = Math.round(vh * (isMobile ? 0.12 : 0.06));
      let x = Math.round((vw - width) / 2);
      let y = Math.round((vh - height) / 2) - nudgeUp;
      const cascadeMax = 6;
      const stepX = Math.round(Math.min(40, vw * 0.03));
      const stepY = Math.round(Math.min(32, vh * 0.03));
      const i = Math.max(0, offsetIndex % cascadeMax);
      x += i * stepX;
      y += i * stepY;
      x = Math.max(marginX, Math.min(x, vw - width - marginX));
      y = Math.max(marginY, Math.min(y, vh - height - marginY));
      return { x, y, width, height };
    };
    const rect = computeResponsiveRect(createSequenceRef.current);
    createSequenceRef.current = (createSequenceRef.current + 1) >>> 0;
    const newNode: Node = {
      id: `iframe-provisional-${toolCallId}`,
      type: "iframe",
      position: { x: rect.x, y: rect.y },
      data: { html: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>', title: 'Creating…', ...nodeData },
      style: { width: rect.width, height: rect.height },
      zIndex: 900,
      selected: true,
    } as unknown as Node;
    setNodes((nds) => {
      const deselected = nds.map((n) => ({ ...n, selected: false }));
      return [...deselected, newNode];
    });
    streamingCreateRef.current.set(toolCallId, { nodeId: newNode.id });
    return newNode.id;
  };

  const applyPreviewDomReplace = (windowId: string, newMutations: DomMutation[], session: { baseHtml?: string; currentHtml?: string }): string | null => {
    const nodeId = windowIdToNodeIdRef.current.get(windowId);
    if (!nodeId) return null;
    // Initialize base/current from node state if not present
    if (!session.baseHtml || !session.currentHtml) {
      const live = getLiveIframeHtml(nodeId);
      const node = nodes.find(n => n.id === nodeId);
      const html = live ?? ((node?.data as any)?.html || '');
      session.baseHtml = html;
      session.currentHtml = html;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(session.currentHtml || '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>', 'text/html');
    const applyMutations = (doc: Document, muts: DomMutation[]) => {
      for (const m of muts) {
        try {
          const list = Array.from(doc.querySelectorAll((m as any).selector || '')) as HTMLElement[];
          if (m.action === 'set_text') {
            for (const el of list) { el.textContent = m.text; }
          } else if (m.action === 'set_html') {
            for (const el of list) { el.innerHTML = m.html; }
          } else if (m.action === 'replace_with_html') {
            for (const el of list) {
              const tpl = doc.createElement('template');
              tpl.innerHTML = m.html;
              const frag = tpl.content.cloneNode(true);
              el.replaceWith(...Array.from((frag as DocumentFragment).childNodes));
            }
          } else if (m.action === 'insert_html') {
            for (const el of list) { el.insertAdjacentHTML(m.position, m.html); }
          } else if (m.action === 'set_attr') {
            for (const el of list) { el.setAttribute(m.name, m.value); }
          } else if (m.action === 'remove_attr') {
            for (const el of list) { el.removeAttribute(m.name); }
          } else if (m.action === 'add_class') {
            for (const el of list) { el.classList.add(m.class); }
          } else if (m.action === 'remove_class') {
            for (const el of list) { el.classList.remove(m.class); }
          } else if (m.action === 'remove') {
            for (const el of list) { el.remove(); }
          }
        } catch {}
      }
    };
    applyMutations(doc, newMutations);
    const updated = '<!DOCTYPE html>' + (doc.documentElement ? doc.documentElement.outerHTML : '');
    session.currentHtml = updated;
    updateIframeThrottled(nodeId, updated, true); // isStreaming = true during dom_replace streaming
    return nodeId;
  };

  // Shared stream processor for both user submit and iframe messages
  const processAgentStream = useCallback(async (params: {
    prompt: string;
    userMessageForHistory: string;
    clearInputAfter?: boolean;
  }) => {
    const { prompt, userMessageForHistory, clearInputAfter = false } = params;
    
    const provider = getSelectedProvider();
    if (!provider) {
      setShowApiDialog(true);
      return;
    }

    const apiKey = getApiKey(provider as AIProvider);
    if (!apiKey) {
      setShowApiDialog(true);
      return;
    }

    setIsLoading(true);
    setRightText("");
    setTokenUsage(null);
    try {
      try { console.log('[GENUI][agent] start', { provider, promptPreview: prompt.slice(0, 240), context: buildAgentContext() }); } catch {}
      const stream = await runAgentStream({
        prompt,
        apiKey,
        provider,
        context: buildAgentContext(),
        history: historyRef.current as any,
        tools: { createNewWindow, domReplace, updateWindowTitle, setWindowHtml },
      });
      const toolResultsAcc: any[] = [];
      const toolHistoryMsgsAcc: ModelMessage[] = [];
      const seenToolCalls = new Set<string>(); // Track which tool calls we've already displayed
      const toolCallIdToName = new Map<string, string>(); // Map toolCallId to toolName for streaming
      let finalText = "";
      for await (const part of (stream as any).fullStream) {
        const t = (part as any).type;
        // try { 
        //   console.log('[GENUI][stream] event - full part object:', part); 
        // } catch {}
        if (t === 'text-delta') {
          // In v5, the property is 'text', not 'textDelta'
          const delta = (part as any).text ?? (part as any).textDelta ?? '';
          // try { console.log('[GENUI][stream] text-delta found:', delta); } catch {}
          if (delta) {
            finalText += delta;
            setRightText((prev) => prev + delta);
          }
        } else if (t === 'tool-call' || t === 'tool-input-start') {
          // In v5, tool-call or tool-input-start event fires when tool call starts
          const toolName = (part as any).toolName as string;
          const toolCallId = ((part as any).toolCallId ?? (part as any).toolCall?.toolCallId ?? (part as any).id) as string;
          try { console.log('[GENUI][stream] tool-call/start:', { toolName, toolCallId, part }); } catch {}
          
          // Store the toolName for this toolCallId so we can use it in delta events
          if (toolName && toolCallId) {
            toolCallIdToName.set(toolCallId, toolName);
          }
          
          // Only show tool name once per toolCallId
          if (toolName && !seenToolCalls.has(toolCallId)) {
            seenToolCalls.add(toolCallId);
            setRightText((prev) => {
              const prefix = prev && !prev.endsWith("\n") ? prev + "\n" : prev;
              return prefix + `🛠️ ${toolName}\n`;
            });
          }
          
          if (toolName === 'create_new_window') {
            const nodeId = ensureProvisionalCreateNode(toolCallId);
            // Keep focus on provisional node
            setNodes((nds) => nds.map(n => ({ ...n, selected: n.id === nodeId })) as any);
          } else if (toolName === 'dom_replace') {
            streamingDomRef.current.set(toolCallId, { appliedCount: 0 });
          } else if (toolName === 'set_window_html') {
            streamingSetHtmlRef.current.set(toolCallId, {});
          }
        } else if (t === 'tool-call-delta' || t === 'tool-input-delta') {
          const toolCallId = ((part as any).toolCallId ?? (part as any).toolCall?.toolCallId ?? (part as any).id) as string;
          // Get toolName from our map since it's not in the delta event
          const toolName = toolCallIdToName.get(toolCallId) ?? (part as any).toolName;
          const delta = (part as any).delta ?? (part as any).argsTextDelta ?? '';
          // try { console.log('[GENUI][stream] tool-delta:', { toolName, toolCallId, delta: delta?.slice?.(0, 100) }); } catch {}
          if (toolName === 'create_new_window') {
            const nodeId = ensureProvisionalCreateNode(toolCallId);
            const entry = streamingCreateRef.current.get(toolCallId) || { nodeId };
            // Update partial name if present
            const namePartial = extractLatestJsonStringField((entry as any).argsAccum ? (entry as any).argsAccum + delta : delta, 'name');
            if (namePartial && namePartial !== entry.name) {
              entry.name = namePartial;
              provisionalNameToNodeIdRef.current.set(namePartial, nodeId);
              setNodes((nds) => nds.map(n => n.id === nodeId ? ({ ...n, data: { ...(n.data as any), title: namePartial } }) as any : n));
            }
            (entry as any).argsAccum = ((entry as any).argsAccum || '') + delta;
            // Update partial html if present
            const htmlPartial = extractLatestJsonStringField((entry as any).argsAccum, 'html');
            if (htmlPartial != null) {
              const healed = healHtmlStream(htmlPartial);
              updateIframeThrottled(nodeId, healed, true); // isStreaming = true
            }
            streamingCreateRef.current.set(toolCallId, entry as any);
          } else if (toolName === 'dom_replace') {
            const entry = streamingDomRef.current.get(toolCallId) || { appliedCount: 0 } as any;
            (entry as any).argsAccum = ((entry as any).argsAccum || '') + delta;
            try {
              const parsed = JSON.parse(((entry as any).argsAccum as string).trim().replace(/,+$/g, '')) as { windowId: string; mutations: DomMutation[] };
              if (parsed?.windowId) entry.windowId = parsed.windowId;
              const muts = parsed?.mutations || [];
              const toApply = muts.slice(entry.appliedCount || 0);
              if (toApply.length && entry.windowId) {
                applyPreviewDomReplace(entry.windowId, toApply, entry);
                entry.appliedCount = (entry.appliedCount || 0) + toApply.length;
              }
              streamingDomRef.current.set(toolCallId, entry);
            } catch {}
          } else if (toolName === 'set_window_html') {
            const entry = streamingSetHtmlRef.current.get(toolCallId) || {} as any;
            entry.argsAccum = ((entry.argsAccum || '') + delta);
            // Try to extract windowId and html incrementally
            const windowIdPartial = extractLatestJsonStringField(entry.argsAccum, 'windowId');
            if (windowIdPartial) entry.windowId = windowIdPartial;
            const htmlPartial = extractLatestJsonStringField(entry.argsAccum, 'html');
            if (htmlPartial != null && entry.windowId) {
              const nodeId = windowIdToNodeIdRef.current.get(entry.windowId as string);
              if (nodeId) {
                const healed = healHtmlStream(htmlPartial);
                updateIframeThrottled(nodeId, healed, true);
              }
            }
            streamingSetHtmlRef.current.set(toolCallId, entry);
          }
        } else if (t === 'tool-result') {
          toolResultsAcc.push(part);
          // Pair assistant tool-call with tool result for history
          try {
            const toolName = (part as any).toolName as string;
            const toolCallId = (part as any).toolCallId as string;
            let argsObj: any = {};
            if (toolName === 'create_new_window') {
              const entry = streamingCreateRef.current.get(toolCallId) as any;
              if (entry && entry.argsAccum) {
                try { argsObj = JSON.parse(String(entry.argsAccum).trim().replace(/,+$/g, '')); } catch {}
              }
            } else if (toolName === 'dom_replace') {
              const entry = streamingDomRef.current.get(toolCallId) as any;
              if (entry && entry.argsAccum) {
                try { argsObj = JSON.parse(String(entry.argsAccum).trim().replace(/,+$/g, '')); } catch {}
              }
            } else if (toolName === 'set_window_html') {
              const entry = streamingSetHtmlRef.current.get(toolCallId) as any;
              if (entry && entry.argsAccum) {
                try { argsObj = JSON.parse(String(entry.argsAccum).trim().replace(/,+$/g, '')); } catch {}
              }
            }
            toolHistoryMsgsAcc.push(toToolCallAssistantMessage(toolName, toolCallId, argsObj));
            toolHistoryMsgsAcc.push(toToolMessageFromResult({ toolCallId, toolName, result: (part as any).output }));
          } catch {}
          // Cleanup provisional for create window
          if ((part as any).toolName === 'create_new_window') {
            const result = (part as any).output as CreateNewWindowResult;
            const toolCallId = (part as any).toolCallId as string;
            const provisional = streamingCreateRef.current.get(toolCallId);
            if (provisional && provisional.nodeId && provisional.nodeId !== result.nodeId) {
              // Remove the provisional node now that the real node exists
              setNodes((nds) => nds.filter(n => n.id !== provisional.nodeId));
              streamingCreateRef.current.delete(toolCallId);
            }
          }
        } else if (t === 'finish-step' || t === 'finish') {
          // Handle incomplete tool calls due to length limits
          const finishReason = (part as any).finishReason;
          if (finishReason === 'length') {
            try { console.warn('[GENUI][stream] Stream finished due to length limit - tool call may be incomplete'); } catch {}
            setRightText((prev) => (prev ? prev  : prev));
          }
        } else if (t === 'error') {
          const msg = String((part as any).error || 'Unknown streaming error');
          setRightText((prev) => (prev ? prev + "\n" : prev) + `Error: ${msg}`);
        }
      }
      // After stream is done, ensure we capture final text and tool results for history
      const text = await (stream as any).text;
      const streamToolResults = await (stream as any).toolResults;
      const toolResults = (Array.isArray(streamToolResults) && streamToolResults.length)
        ? streamToolResults
        : (toolResultsAcc || []).map((p: any) => ({ toolCallId: p.toolCallId, toolName: p.toolName, result: p.output }));
      try { console.log('[GENUI][agent] response(stream)', { textPreview: text?.slice?.(0, 240) }); } catch {}
      try { console.log('[GENUI][agent] toolResults(stream)', toolResults); } catch {}
      if (!finalText && text) setRightText(text);
      // Capture token usage (final LLM call) for styled display
      try {
        let usage: any = null;
        try {
          // In v5, use totalUsage which includes all steps
          if ((stream as any).totalUsage) {
            usage = await (stream as any).totalUsage;
            console.log('[GENUI][usage] received from totalUsage:', usage);
          } else if ((stream as any).usage) {
            usage = await (stream as any).usage;
            console.log('[GENUI][usage] received from usage:', usage);
          } else if ((stream as any).response) {
            const resp = await (stream as any).response;
            usage = resp?.usage;
            console.log('[GENUI][usage] received from response.usage:', usage);
          }
        } catch (e) {
          console.error('[GENUI][usage] error getting usage:', e);
        }
        console.log('[GENUI][usage] final usage object:', usage);
        const inRaw = usage?.inputTokens ?? usage?.promptTokens ?? usage?.totalPromptTokens ?? null;
        const outRaw = usage?.outputTokens ?? usage?.completionTokens ?? usage?.totalCompletionTokens ?? null;
        console.log('[GENUI][usage] extracted raw values:', { inRaw, outRaw, types: { in: typeof inRaw, out: typeof outRaw } });
        setTokenUsage({
          input: (typeof inRaw === 'number' && inRaw >= 0) ? inRaw : null,
          output: (typeof outRaw === 'number' && outRaw >= 0) ? outRaw : null,
        });
      } catch (e) {
        console.error('[GENUI][usage] outer error:', e);
      }
      // Append tool-call + tool-result pairs (if any), then final assistant turn, and commit to state
      try {
        const toolMsgs = toolHistoryMsgsAcc.length ? toolHistoryMsgsAcc : (toolResults || []).map((tr: any) => toToolMessageFromResult(tr));
        historyRef.current = [
          ...historyRef.current,
          { role: 'user', content: userMessageForHistory } as ModelMessage,
          ...toolMsgs,
          { role: 'assistant', content: [{ type: 'text', text: (text || finalText || '') } as any] } as ModelMessage,
        ];
      } catch {}
      setHistory(historyRef.current);
      console.log('[GENUI][agent] history', historyRef.current);
      if (clearInputAfter) {
        setInputValue("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try { console.error('[GENUI][agent] error', { error: message }); } catch {}
      if (isAuthError(err)) {
        // remove the bad key and prompt user again
        deleteApiKey(provider as AIProvider);
        setShowApiDialog(true);
        setRightText(`Authentication error for ${provider}. Please enter a valid API key.\n\n${message}`);
      } else {
        setRightText(`Error: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [buildAgentContext, createNewWindow, domReplace, updateWindowTitle, setWindowHtml, toToolCallAssistantMessage, toToolMessageFromResult, ensureProvisionalCreateNode, applyPreviewDomReplace, healHtmlStream, extractLatestJsonStringField, updateIframeThrottled, setNodes, setIsLoading, setRightText, setTokenUsage, setHistory, setInputValue, setShowApiDialog]);

  const handleSubmit = useCallback(async () => {
    const prompt = inputValue.trim();
    if (!prompt) return;
    setLastUserMessage(prompt);

    await processAgentStream({
      prompt,
      userMessageForHistory: prompt,
      clearInputAfter: true,
    });
  }, [inputValue, processAgentStream]);

  // React to iframe postMessages by invoking the agent
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      try { console.log('[GENUI][iframe] message:raw', event.data); } catch {}
      // Identify which iframe sent the message
      const sourceWin = event.source as Window | null;
      if (!sourceWin) return;
      let senderNodeId: string | null = null;
      for (const [nodeId, iframeEl] of nodeIdToIframeRef.current.entries()) {
        if (iframeEl && iframeEl.contentWindow === sourceWin) {
          senderNodeId = nodeId;
          break;
        }
      }
      if (!senderNodeId) return;
      const senderName = nodeIdToNameRef.current.get(senderNodeId) || senderNodeId;

      // Formulate a prompt for the agent based on the message
      const payload = event.data;
      // Gate: only react to explicit messages from our windows
      if (!payload || payload.source !== 'genui-llm-window' || payload.kind !== 'window-event') {
        return;
      }
      if (payload.event !== 'action' && payload.event !== 'submit') {
        return; // ignore other events like generic focus/clicks
      }
      try { console.log('[GENUI][iframe] message:gated', { senderName, payload }); } catch {}
      const messageDesc = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

      await processAgentStream({
        prompt: `Window "${senderName}" sent a message:\n\n${messageDesc}\n\nPlease handle this by using tools as needed.`,
        userMessageForHistory: `Window ${senderName} message: ${messageDesc}`,
        clearInputAfter: false,
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [processAgentStream]);

  // Track focus when a node is clicked
  const onNodeClick = useCallback<NodeMouseHandler>((_e, node) => {
    if (node.type === "iframe") {
      const winId = nodeIdToWindowIdRef.current.get(node.id) || null;
      setFocusedWindowId(winId);
      try { console.debug('[GENUI][focus] window', { windowId: winId }); } catch {}
    } else {
      setFocusedWindowId(null);
      try { console.debug('[GENUI][focus] cleared'); } catch {}
    }
  }, []);

  const handleKeyPress = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="w-screen h-screen flex flex-col">
      {/* React Flow Canvas */}
      <div className="flex-1 relative">
        {/* Background waves layer */}
        <div className="absolute inset-0 pointer-events-none opacity-80">
          <svg
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
            viewBox="0 0 1440 900"
          >
            <defs>
              <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#a8cec5" />
                <stop offset="100%" stopColor="#c8ddd8" />
              </linearGradient>
              <linearGradient id="stroke" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#85b5a8" />
                <stop offset="100%" stopColor="#9dc5b8" />
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#g1)" />
            <path
              d="M0,120 C240,160 420,60 720,120 C1020,180 1200,100 1440,140"
              fill="none"
              stroke="url(#stroke)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.35"
            />
            <path
              d="M0,420 C240,480 480,380 720,420 C960,460 1200,360 1440,420"
              fill="none"
              stroke="url(#stroke)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.35"
            />
            <path
              d="M0,720 C240,760 420,660 720,720 C1020,780 1200,700 1440,740"
              fill="none"
              stroke="url(#stroke)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity="0.35"
            />
          </svg>
        </div>
        
        {/* Top-right settings button */}
        <div className="absolute right-6 top-6 z-30">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="btn btn-circle min-h-0 h-10 w-10 bg-white/90 hover:bg-white shadow border border-stone-300 text-stone-700"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={true}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          translateExtent={[
            [0, 0],
            [window.innerWidth, window.innerHeight],
          ]}
          nodeExtent={[
            [0, 0],
            [window.innerWidth, window.innerHeight],
          ]}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          className="canvas-background"
          proOptions={{ hideAttribution: true }}
        >
        </ReactFlow>
      </div>
      {/* Bottom-center unified card: responses + input blended */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 w-full max-w-3xl px-4">
        <div className="rounded-[28px] border border-stone-300 bg-white/90 shadow-lg overflow-hidden backdrop-blur-sm">
          {(rightText || isLoading || lastUserMessage) ? (
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <div className="text-stone-700 text-sm font-medium truncate pr-2">
                  {lastUserMessage}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-0 h-6 px-2"
                onClick={() => setResponsesCollapsed((v) => !v)}
                aria-label={responsesCollapsed ? 'Expand' : 'Collapse'}
              >
                {responsesCollapsed ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
            </div>
          ) : null}

          {!responsesCollapsed && (rightText || isLoading) ? (
            <div
              ref={rightPanelRef}
              className="px-5 pb-3 text-sm text-stone-800 whitespace-pre-wrap break-words overflow-y-auto space-y-3 max-h-[38vh]"
            >
              <div className="space-y-1">
                {rightText.split('\n').map((line, idx) => {
                  const isTool = line.startsWith('🛠️ ');
                  const display = isTool ? line.replace(/^🛠️\s*/, '') : line;
                  return (
                    <div
                      key={idx}
                      className={isTool ? 'border border-stone-300 bg-stone-50 rounded-md px-2 py-1 text-stone-700' : ''}
                    >
                      {isTool ? (
                        <span className="inline-flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-stone-600" />
                          <span>{display || '\u00A0'}</span>
                        </span>
                      ) : (display || '\u00A0')}
                    </div>
                  );
                })}
              </div>
              <div className="divider my-2"></div>
              <div className="flex gap-2">
                <div className="badge badge-ghost gap-1">
                  <span className="text-stone-500">Input</span>
                  <span className="font-medium">{tokenUsage?.input ?? 'N/A'}</span>
                </div>
                <div className="badge badge-ghost gap-1">
                  <span className="text-stone-500">Output</span>
                  <span className="font-medium">{tokenUsage?.output ?? 'N/A'}</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Helper examples shown only before any user message */}
          {!hasAnyUserMessage && !responsesCollapsed && !isLoading && !rightText ? (
            <div className="px-5 pt-4 pb-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {EXAMPLE_PROMPTS.map((ex, idx) => (
                  <div
                    key={idx}
                    className="border border-stone-300/70 bg-stone-50 hover:bg-stone-100 rounded-xl p-3 transition-colors cursor-pointer"
                    onClick={() => { setInputValue(ex.description); inputRef.current?.focus(); }}
                  >
                    <button
                      type="button"
                      className="text-sm font-medium text-stone-700 hover:underline"
                      onClick={(e) => { e.stopPropagation(); setInputValue(ex.description); inputRef.current?.focus(); }}
                    >
                      {ex.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Input footer integrated into the card */}
            <div className="relative flex items-center bg-stone-200/90 backdrop-blur-sm rounded-[24px] shadow-sm">
              <Input
                type="text"
                placeholder="What do you want to build?"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                className="w-full bg-transparent border-none pl-6 pr-20 py-4 h-auto text-lg text-stone-600 placeholder:text-stone-500 rounded-[24px] focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none font-normal"
                disabled={isLoading}
                ref={inputRef}
              />
              <div className="absolute right-2 z-20 pointer-events-auto flex items-center gap-2">
                <button
                  onClick={handleSubmit}
                  className="btn btn-circle min-h-0 h-11 w-11 bg-amber-700 hover:bg-amber-800 text-white shadow-md hover:shadow-lg active:scale-95 border-none"
                  type="button"
                  disabled={isLoading}
                >
                  <ArrowUp className={`w-5 h-5 ${isLoading ? 'animate-bounce' : ''}`} />
                </button>
              </div>
            </div>
          </div>
      </div>
      <ApiKeyDialog
        open={showApiDialog || showSettings}
        onClose={() => { setShowApiDialog(false); setShowSettings(false); }}
        onSave={() => {
          // Retry submit after saving key (only if invoked from missing key flow)
          if (showApiDialog) setTimeout(() => handleSubmit(), 0);
          setShowApiDialog(false);
          setShowSettings(false);
        }}
      />
    </div>
  );
}

export default App;
