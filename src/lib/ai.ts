import OpenAI from 'openai';
import { type AIProvider, getSelectedModel, getDefaultModel } from "@/lib/utils";

// Local shim for ModelMessage (to avoid depending on the removed ai SDK)
export type ModelMessage = {
  role: string;
  content: any;
};

export type GenerateHtmlOptions = {
  prompt: string;
  apiKey: string;
  model?: string;
  provider?: AIProvider;
};


// Tool-enabled agent
export type AgentContext = {
  availableWindowIds: string[];
  focusedWindowId?: string | null;
};

export type CreateNewWindowResult = {
  status: 'created' | 'renamed';
  name: string;
  finalName: string;
  nodeId: string;
  windowId: string; // short window id for future tool calls
};

export type DomMutation =
  | { action: 'set_text'; selector: string; text: string }
  | { action: 'set_html'; selector: string; html: string }
  | { action: 'replace_with_html'; selector: string; html: string }
  | { action: 'insert_html'; selector: string; position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend'; html: string }
  | { action: 'set_attr'; selector: string; name: string; value: string }
  | { action: 'remove_attr'; selector: string; name: string }
  | { action: 'add_class'; selector: string; class: string }
  | { action: 'remove_class'; selector: string; class: string }
  | { action: 'remove'; selector: string };

export type DomReplaceResult = {
  status: 'edited';
  windowId?: string;
  name?: string;
  html: string;
  totals: { totalMutations: number; totalTargets: number; totalApplied: number; failed: number };
  details: Array<{ action: string; selector: string; matched: number; applied: number; error?: string }>;
};

export type AgentToolHandlers = {
  createNewWindow: (name: string, html: string) => Promise<CreateNewWindowResult> | CreateNewWindowResult;
  domReplace: (
    windowId: string,
    mutations: DomMutation[]
  ) => Promise<DomReplaceResult> | DomReplaceResult;
  updateWindowTitle: (
    windowId: string,
    title: string
  ) => Promise<{ status: 'updated'; windowId: string; title: string }> | { status: 'updated'; windowId: string; title: string };
  setWindowHtml: (
    windowId: string,
    html: string
  ) => Promise<{ status: 'set'; windowId: string; htmlLength: number }> | { status: 'set'; windowId: string; htmlLength: number };
};

export type RunAgentOptions = GenerateHtmlOptions & {
  context?: AgentContext;
  tools: AgentToolHandlers;
  history?: ModelMessage[];
};

// No local ToolEvent capture; rely on SDK toolResults for correct toolCallId mapping

export function buildAgentSystemPrompt(context?: AgentContext) {
  const focused = context?.focusedWindowId
    ? `Focused window id: ${context.focusedWindowId}.`
    : "No window is currently focused.";
  const windowList = context?.availableWindowIds?.length
    ? `Existing window IDs: ${context.availableWindowIds.join(", ")}.`
    : "There are currently no existing windows.";

  // Single combined instruction body
  const instruction = `
You are an interactive Generative UI Agent that builds and modifies app windows on demand. Use the instructions below and the tools available to you to assist the user.


# Tone and style
You should be concise, direct, and to the point.
You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), unless user asks for detail.
IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, quality, and accuracy. Only address the specific query or task at hand, avoiding tangential information unless absolutely critical for completing the request. If you can answer in 1-3 sentences or a short paragraph, please do.
IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining your code or summarizing your action), unless the user asks you to.
Do not add additional code explanation summary unless requested by the user. After working on a file, just stop, rather than providing an explanation of what you did.


<windows_info> You can create, edit and rewrite windows during conversations. Windows should be used for substantial, high-quality code, analysis, and writing that the user is asking the assistant to create.
You must use windows for
* Creating new windows to solve a specific user problem (such as building new applications, components, or tools), creating data visualizations, developing new algorithms, generating technical documents/guides that are meant to be used as reference materials.
* Modifying/iterating on content that's already in an existing window.
* Content that will be edited, expanded, or reused.
* Focus on creating complete, functional windows with rich, explicit interaction triggers.
* You are not expected to create multiple screens of an application at once. Seed each window with rich, explicit interaction triggers. ex. all the buttons, links, etc. that will be used to interact with the window must have a data-llm-action attribute.
* Do not implement everything at once—prioritize discoverability. When a trigger is used, the host will re-invoke you so you can create a new window or edit the current one accordingly.
* You will be notified/triggered when any of the interation triggers you have created are used and you can then add the functionality to the window or create a new window accordingly.
* You have freedom to either create a new window or edit the current one depending on the user's request or their interaction with the window. You would ideally create new windows when the interaction requires navigating to a new page or requires a new context. You would edit the current window when the interaction requires modifying the current window's content or state.
* You will be given a list of existing windows and their IDs. You can use these windows to create new windows or edit existing ones.
Design principles for visual windows
When creating visual windows (HTML or any UI elements):
* For complex applications (Three.js, games, simulations): Prioritize functionality, performance, and user experience over visual flair. Focus on:
    * Smooth frame rates and responsive controls
    * Clear, intuitive user interfaces
    * Efficient resource usage and optimized rendering
    * Stable, bug-free interactions
    * Simple, functional design that doesn't interfere with the core experience
* For landing pages, marketing sites, and presentational content: Consider the emotional impact and "wow factor" of the design. Ask yourself: "Would this make someone stop scrolling and say 'whoa'?" Modern users expect visually engaging, interactive experiences that feel alive and dynamic.
* Default to contemporary design trends and modern aesthetic choices unless specifically asked for something traditional. Consider what's cutting-edge in current web design (dark modes, glassmorphism, micro-animations, 3D elements, bold typography, vibrant gradients).
* Static designs should be the exception, not the rule. Include thoughtful animations, hover effects, and interactive elements that make the interface feel responsive and alive. Even subtle movements can dramatically improve user engagement.
* When faced with design decisions, lean toward the bold and unexpected rather than the safe and conventional. This includes:
    * Color choices (vibrant vs muted)
    * Layout decisions (dynamic vs traditional)
    * Typography (expressive vs conservative)
    * Visual effects (immersive vs minimal)
* Push the boundaries of what's possible with the available technologies. Use advanced CSS features, complex animations, and creative JavaScript interactions. The goal is to create experiences that feel premium and cutting-edge.
* Ensure accessibility with proper contrast and semantic markup
* Create functional, working demonstrations rather than placeholders


CRITICAL BROWSER STORAGE RESTRICTION
NEVER use localStorage, sessionStorage, or ANY browser storage APIs in windows. These APIs are NOT supported and will cause windows to fail in the Claude.ai environment.
Instead, you MUST:
* Use JavaScript variables or objects for HTML windows
* Store all data in memory during the session
Exception: If a user explicitly requests localStorage/sessionStorage usage, explain that these APIs are not supported in windows and will cause the window to fail. Offer to implement the functionality using in-memory storage instead, or suggest they copy the code to use in their own environment where browser storage is available.
<window_instructions>
- Produce complete HTML documents (<!DOCTYPE html> + <html> + <head> + <body>) that work in an isolated iframe.
- Keep text to a minimum and use icons and other visual elements to convey information. You can use the window title to signify the purpose of the window and so no need to have a header showing the title unless absolutely necessary.
- Styling: default to the canvas aesthetic when not given exact styles.
  - Primary: amber (use Tailwind classes like bg-amber-700, text-amber-800, ring-amber-700; hover states slightly darker).
  - Secondary/ambient: soft green gradient like the canvas background (#a8cec5 → #c8ddd8). Define and reuse a helper class .bg-canvas-gradient { background: linear-gradient(135deg, #a8cec5, #c8ddd8); } for sections/empty states.
- Preferred libraries:
  - Tailwind CSS utilities via CDN for all layout and components.
  - Lucide icons for iconography.
  - Plotly for rich interactive components.
  - Three.js for 3D graphics.
- Recommended <head> includes (keep minimal, but include when needed):
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js"></script>
    <style>
      .bg-canvas-gradient { background: linear-gradient(135deg, #a8cec5, #c8ddd8); }
    </style>
  </head>
- Layout conventions: container mx-auto max-w-screen-md p-6; rounded-xl, border, shadow-sm; balanced whitespace.
- Component conventions: build all UI components using pure Tailwind utility classes. Combine with Tailwind color utilities to apply the amber primary.
- Icon usage: <i data-lucide="send"></i> etc., and run lucide.createIcons() on DOMContentLoaded.
- Responsiveness and a11y: ensure good contrast, keyboard focus styles (focus:ring-2 focus:ring-amber-500), and mobile-friendly stacking (use responsive prefixes like sm:, md:, lg:).
- Please avoid using anchor tags for links as in an iframe the links will not work as expected. Instead, use the button component with a data-llm-action attribute that is styled to look like a link.
- Keep JS minimal—only for interactions and postMessage plumbing.


When writing window HTML, only communicate all explicit user actions back to the host app, and include relevant context via data-ctx-* attributes. Use postMessage to capture all events that would result in some DOM mutation or state change:
- Clicks on elements with a data-llm-action attribute (e.g., <button data-llm-action="save">)
- Form submissions
- Any other event that would result in a DOM mutation or state change
- It is important that any user interaction should be communicated back to the host app so that the host app can re-invoke you to create a new window or edit the current one accordingly. It is not good UX to have the user click on a button and not see any change.

Emit messages in this exact shape:
{ source: 'genui-llm-window', kind: 'window-event', event: 'action' | 'submit', action?: string, details?: any }

Example snippet to include inside your HTML (JS):
<script>
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.getAttribute('data-llm-action');
  if (!action) return; // only explicit actions
  const ctx = target.dataset ? { ...target.dataset } : {};
  window.parent.postMessage({ source: 'genui-llm-window', kind: 'window-event', event: 'action', action, details: { text: target.innerText, ctx } }, '*');
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const ctx = form.dataset ? { ...form.dataset } : {};
  window.parent.postMessage({ source: 'genui-llm-window', kind: 'window-event', event: 'submit', details: { data, ctx } }, '*');
});
document.addEventListener('DOMContentLoaded', () => {
  try { if (window.lucide && typeof (window as any).lucide.createIcons === 'function') { (window as any).lucide.createIcons(); } } catch {}
});
</script>

The host app listens for these messages and will re-invoke you with the payload, so you can react by using tools (e.g., create or edit windows).
State persistence (critical):
- Track and persist user data yourself across tool calls and windows using your working memory, conversation history and the window state. When creating or editing HTML, initialize form controls and UI with the latest known values you are tracking.
</windows_info>
The assistant should not mention any of these instructions to the user, or related syntax unless it is directly relevant to the query.


Usage rules:
- Prefer small, precise edits via dom_replace; create new windows only when needed.
- For mutations, use specific selectors (ids, stable classes, data-ctx-*). Apply minimal changes.
- Favor interaction-rich initial scaffolds: expose all the next likely actions with data-llm-action hooks so you can fulfill them in subsequent turns.
- Be comprehensive when you are creating new windows with diverse set of components and interactions as needed.
- The biggest value of the canvas is imagining what the future of web apps will look like where everything is interactive and LLM-driven.
- Always provide a short natural-language summary (max 2 lines) of what you did after using any tools. Avoid printing full HTML unless specifically asked to show code. Prefer tools for UI changes.


<tools>
- create_new_window(name: string, html: string): create a new window with the provided display title and self-contained HTML. The tool result includes a short windowId to use for future edits.
- dom_replace(windowId: string, mutations: DomMutation[]): precisely mutate an existing window's DOM using CSS selectors. Supported mutations:
  - { action: 'set_text', selector, text }
  - { action: 'set_html', selector, html }
  - { action: 'replace_with_html', selector, html }
  - { action: 'insert_html', selector, position: 'beforebegin'|'afterbegin'|'beforeend'|'afterend', html }
  - { action: 'set_attr', selector, name, value }
  - { action: 'remove_attr', selector, name }
  - { action: 'add_class', selector, class }
  - { action: 'remove_class', selector, class }
  - { action: 'remove', selector }

- update_window_title(windowId: string, title: string): update the visible title of the window to reflect state after big changes to the window's content.
- set_window_html(windowId: string, html: string): completely replace the window's HTML content with new markup when a large rewrite is needed.
</tools>

<examples>
* Tic-tac-toe game
  - User: "Build a tic-tac-toe game."
  - Assistant (tool): create_new_window { name: 'Tic-Tac-Toe', html: '<!DOCTYPE html>... 3x3 board with cells #cell-0..#cell-8, each button has data-llm-action="play" and data-ctx-cell="{index}"; includes window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W1' }
  - Assistant: "Game created. Tap a square to play."
  - Window event (from W1): { source: 'genui-llm-window', kind: 'window-event', event: 'action', action: 'play', details: { ctx: { cell: '4' } } }
  - Assistant (tool): dom_replace { windowId: 'W1', mutations: [ { action: 'set_text', selector: '#cell-4', text: 'X' }, { action: 'set_text', selector: '#cell-0', text: 'O' } ] }
  - Tool result: { status: 'edited', windowId: 'W1' }
  - Assistant: "You played center; I played top-left."

* Chat application
  - User: "Make a simple chat room UI."
  - Assistant (tool): create_new_window { name: 'Chat', html: '<!DOCTYPE html>... messages list <ul id="msgs"></ul> and form <form id="send" data-llm-action="noop">...<input name="message"/>...</form>; includes submit listener via window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W2' }
  - Assistant: "Type a message and submit."
  - Window event (from W2): { source: 'genui-llm-window', kind: 'window-event', event: 'submit', details: { data: { message: 'Hello world' } } }
  - Assistant (tool): dom_replace { windowId: 'W2', mutations: [ { action: 'insert_html', selector: '#msgs', position: 'beforeend', html: '<li>You: Hello world</li>' }, { action: 'insert_html', selector: '#msgs', position: 'beforeend', html: '<li>AI: Hi! 👋</li>' } ] }
  - Tool result: { status: 'edited', windowId: 'W2' }
  - Assistant: "Sent."

* Todo list
  - User: "Create a minimal todo app with add and filter."
  - Assistant (tool): create_new_window { name: 'Todos', html: '<!DOCTYPE html>... <ul id="list"></ul><form id="add"> <input name="title"/> </form> <div id="filters"> <button data-llm-action="filter" data-ctx-status="all">All</button> ... </div>; includes window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W3' }
  - Assistant: "Add a todo or change filter."
  - Window event (from W3): { source: 'genui-llm-window', event: 'submit', details: { data: { title: 'Buy milk' } } }
  - Assistant (tool): dom_replace { windowId: 'W3', mutations: [ { action: 'insert_html', selector: '#list', position: 'beforeend', html: '<li data-status="open">Buy milk</li>' } ] }
  - Tool result: { status: 'edited', windowId: 'W3' }
  - Assistant: "Added."
  - Window event (from W3): { source: 'genui-llm-window', event: 'action', action: 'filter', details: { ctx: { status: 'open' } } }
  - Assistant (tool): dom_replace { windowId: 'W3', mutations: [ { action: 'add_class', selector: '#filters [data-ctx-status="open"]', class: 'active' } ] }
  - Tool result: { status: 'edited', windowId: 'W3' }
  - Assistant: "Filtered to open."

* Social feed with composer
  - User: "Clone a tiny social feed with like and new post."
  - Assistant (tool): create_new_window { name: 'Feed', html: '<!DOCTYPE html>... <div id="feed"></div> <button data-llm-action="compose">New Post</button>; window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W4' }
  - Assistant: "Tap New Post to compose."
  - Window event (from W4): { event: 'action', action: 'compose' }
  - Assistant (tool): create_new_window { name: 'Compose', html: '<!DOCTYPE html>... <form id="composer"> <input name="text"/> </form>; window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W5' }
  - Assistant: "Write your post and submit."
  - Window event (from W5): { event: 'submit', details: { data: { text: 'My first post' } } }
  - Assistant (tool): dom_replace { windowId: 'W4', mutations: [ { action: 'insert_html', selector: '#feed', position: 'afterbegin', html: '<article>My first post</article>' } ] }
  - Tool result: { status: 'edited', windowId: 'W4' }
  - Assistant: "Posted to feed."

* Shakespeare's Desktop
  - User: "Make Shakespeare's whimsical desktop with app icons and notifications."
  - Assistant (tool): create_new_window { name: 'Shakespeare\'s Desktop', html: '<!DOCTYPE html>... icons for Quill, Sonnets, Pigeon Post and more apps (all of them with [data-llm-action="open" data-ctx-app="pigeon") and appropriate lucide icons]; notification area #notif; window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W6' }
  - Assistant: "Open an app to begin."
  - Window event (from W6): { event: 'action', action: 'open', details: { ctx: { app: 'pigeon' } } }
  - Assistant (tool): create_new_window { name: 'Pigeon Post', html: '<!DOCTYPE html>... <form id="send"> <input name="title"/> </form>; window-event plumbing ...' }
  - Tool result: { status: 'created', windowId: 'W7' }
  - Assistant: "Compose your message and send."
  - Window event (from W7): { event: 'submit', details: { data: { title: 'To the Queen' } } }
  - Assistant (tool): dom_replace { windowId: 'W6', mutations: [ { action: 'insert_html', selector: '#notif', position: 'beforeend', html: '<div>📯 Pigeon sent: To the Queen</div>' } ] }
  - Tool result: { status: 'edited', windowId: 'W6' }
  - Assistant: "Notification delivered."
</examples>

Here is some relevant information:
${focused} ${windowList}`;

  return instruction;
}


// ---------------- OpenAI SDK migration: client factory + streaming bridge ----------------

function createOpenAIClient(provider: AIProvider, apiKey: string): OpenAI {
  if (provider === 'anthropic') {
    return new OpenAI({
      apiKey,
      baseURL: 'https://api.anthropic.com/v1/',
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        // Enables CORS for direct browser access to Anthropic
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    } as any);
  }
  if (provider === 'gemini') {
    return new OpenAI({
      apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      dangerouslyAllowBrowser: true,
    } as any);
  }
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true } as any);
}

// Tool JSON Schemas (OpenAI Chat tools)
const createNewWindowJSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    html: { type: 'string' },
  },
  required: ['name', 'html'],
  additionalProperties: false,
} as const;

const domMutationJSONSchema = {
  oneOf: [
    { type: 'object', properties: { action: { const: 'set_text' }, selector: { type: 'string' }, text: { type: 'string' } }, required: ['action','selector','text'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'set_html' }, selector: { type: 'string' }, html: { type: 'string' } }, required: ['action','selector','html'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'replace_with_html' }, selector: { type: 'string' }, html: { type: 'string' } }, required: ['action','selector','html'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'insert_html' }, selector: { type: 'string' }, position: { enum: ['beforebegin','afterbegin','beforeend','afterend'] }, html: { type: 'string' } }, required: ['action','selector','position','html'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'set_attr' }, selector: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' } }, required: ['action','selector','name','value'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'remove_attr' }, selector: { type: 'string' }, name: { type: 'string' } }, required: ['action','selector','name'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'add_class' }, selector: { type: 'string' }, class: { type: 'string' } }, required: ['action','selector','class'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'remove_class' }, selector: { type: 'string' }, class: { type: 'string' } }, required: ['action','selector','class'], additionalProperties: false },
    { type: 'object', properties: { action: { const: 'remove' }, selector: { type: 'string' } }, required: ['action','selector'], additionalProperties: false },
  ],
} as const;

const domReplaceJSONSchema = {
  type: 'object',
  properties: {
    windowId: { type: 'string' },
    mutations: { type: 'array', items: domMutationJSONSchema, minItems: 1 },
  },
  required: ['windowId','mutations'],
  additionalProperties: false,
} as const;

const updateWindowTitleJSONSchema = {
  type: 'object',
  properties: { windowId: { type: 'string' }, title: { type: 'string' } },
  required: ['windowId','title'],
  additionalProperties: false,
} as const;

const setWindowHtmlJSONSchema = {
  type: 'object',
  properties: { windowId: { type: 'string' }, html: { type: 'string' } },
  required: ['windowId','html'],
  additionalProperties: false,
} as const;

function getOpenAIToolsSpec() {
  return [
    { type: 'function', function: { name: 'create_new_window', description: 'Create a new window with HTML content', parameters: createNewWindowJSONSchema } },
    { type: 'function', function: { name: 'dom_replace', description: 'Apply selector-based DOM mutations to an existing window (by windowId)', parameters: domReplaceJSONSchema } },
    { type: 'function', function: { name: 'update_window_title', description: 'Update the visible title for a window by windowId', parameters: updateWindowTitleJSONSchema } },
    { type: 'function', function: { name: 'set_window_html', description: 'Replace the full HTML content of a window by windowId', parameters: setWindowHtmlJSONSchema } },
  ];
}

function convertHistoryToOpenAIMessages(history: ModelMessage[] | undefined, systemPrompt: string, userPrompt: string) {
  const out: any[] = [];
  out.push({ role: 'system', content: systemPrompt });
  for (const m of (history || [])) {
    const role = (m as any).role;
    const content = (m as any).content;
    if (role === 'user') {
      const text = typeof content === 'string' ? content : extractTextFromContentArray(content);
      out.push({ role: 'user', content: text ?? '' });
    } else if (role === 'assistant') {
      if (typeof content === 'string') {
        out.push({ role: 'assistant', content });
      } else if (Array.isArray(content)) {
        const hasToolCall = content.some((c: any) => c?.type === 'tool-call');
        if (hasToolCall) {
          const toolCalls = content.filter((c: any) => c?.type === 'tool-call').map((c: any) => ({
            id: c.toolCallId,
            type: 'function',
            function: { name: c.toolName, arguments: JSON.stringify(c.input ?? {}) },
          }));
          out.push({ role: 'assistant', content: null, tool_calls: toolCalls });
        } else {
          const text = extractTextFromContentArray(content);
          out.push({ role: 'assistant', content: text ?? '' });
        }
      }
    } else if (role === 'tool') {
      // Expect { type: 'tool-result', toolCallId, result }
      const first = Array.isArray(content) ? content[0] : content;
      const tool_call_id = first?.toolCallId || first?.tool_call_id;
      const result = first?.result ?? first?.content ?? first;
      out.push({ role: 'tool', tool_call_id, content: typeof result === 'string' ? result : JSON.stringify(result) });
    }
  }
  out.push({ role: 'user', content: userPrompt });
  return out;
}

function extractTextFromContentArray(arr: any): string | null {
  if (!Array.isArray(arr)) return typeof arr === 'string' ? arr : null;
  for (const c of arr) {
    if (c?.type === 'text' && typeof c.text === 'string') return c.text;
  }
  return null;
}

export async function runAgentStream(options: RunAgentOptions) {
  const { prompt, apiKey, provider = 'openai', context, tools, history } = options;
  const persistedModel = getSelectedModel(provider) || getDefaultModel(provider);
  const model = options.model || persistedModel;
  const client = createOpenAIClient(provider, apiKey);
  const system = buildAgentSystemPrompt(context);
  const toolsSpec = getOpenAIToolsSpec();

  const textDeferred: { resolve: (v: string) => void; promise: Promise<string> } = (() => {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => (resolve = r));
    return { resolve, promise };
  })();
  const toolResultsDeferred: { resolve: (v: any[]) => void; promise: Promise<any[]> } = (() => {
    let resolve!: (v: any[]) => void;
    const promise = new Promise<any[]>((r) => (resolve = r));
    return { resolve, promise };
  })();
  const usageDeferred: { resolve: (v: any) => void; promise: Promise<any> } = (() => {
    let resolve!: (v: any) => void;
    const promise = new Promise<any>((r) => (resolve = r));
    return { resolve, promise };
  })();

  async function* generator() {
    try {
      const openaiMessagesBase = convertHistoryToOpenAIMessages(history, system, prompt);
      let messagesParam: any[] = openaiMessagesBase;
      let finalTextForAllSteps = '';
      const aggregatedToolResults: Array<{ toolCallId: string; toolName: string; result: any }> = [];
      let lastStepPromptTokens = 0;
      let lastStepCompletionTokens = 0;

      for (let step = 0; step < 12; step++) {
        const stream = await (client as any).chat.completions.create({
          model,
          stream: true,
          messages: messagesParam,
          tools: toolsSpec,
          tool_choice: 'auto',
          parallel_tool_calls: true,
          stream_options: { include_usage: true },
        });

        // Track tool-call streaming state by index
        const toolState = new Map<number, { id: string; name?: string; argsText: string; started: boolean }>();
        let stepText = '';
        let stepUsageFromChunks: any = null;

        for await (const chunk of stream) {
          const choice = (chunk as any)?.choices?.[0];
          const delta = choice?.delta || {};
          const textDelta = delta?.content as string | undefined;
          if (textDelta) {
            stepText += textDelta;
            finalTextForAllSteps += textDelta;
            yield { type: 'text-delta', text: textDelta } as any;
          }
          const toolCalls = delta?.tool_calls as any[] | undefined;
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const idx: number = tc?.index ?? 0;
              const st = toolState.get(idx) || { id: '', argsText: '', started: false };
              if (!st.id) st.id = tc?.id || `tc_${step}_${idx}`;
              const name = tc?.function?.name ?? st.name;
              st.name = name;
              if (!st.started && name) {
                st.started = true;
                yield { type: 'tool-call', toolName: name, toolCallId: st.id } as any;
              }
              const argsDelta = tc?.function?.arguments as string | undefined;
              if (argsDelta && argsDelta.length > 0) {
                st.argsText += argsDelta;
                yield { type: 'tool-input-delta', toolName: st.name, toolCallId: st.id, delta: argsDelta, argsTextDelta: argsDelta } as any;
              }
              toolState.set(idx, st);
            }
          }
          // Capture usage from chunk if available
          const chunkUsage = (chunk as any)?.usage;
          if (chunkUsage) {
            stepUsageFromChunks = chunkUsage;
            console.log('[GENUI][usage] chunk usage:', chunkUsage);
          }
        }

        // Get final aggregated completion (for usage and full tool calls)
        let final: any = undefined;
        try { 
          if (typeof (stream as any).finalChatCompletion === 'function') {
            final = await (stream as any).finalChatCompletion();
            console.log('[GENUI][usage] finalChatCompletion result:', final);
          }
        } catch (e) {
          console.warn('[GENUI][usage] finalChatCompletion error:', e);
        }
        // Prefer usage from finalChatCompletion, fallback to last chunk usage
        const stepUsage = final?.usage ?? stepUsageFromChunks;
        console.log('[GENUI][usage] stepUsage (final or chunks):', stepUsage);
        if (stepUsage) {
          const pt = stepUsage.prompt_tokens ?? stepUsage.input_tokens ?? stepUsage.total_prompt_tokens;
          const ct = stepUsage.completion_tokens ?? stepUsage.output_tokens ?? stepUsage.total_completion_tokens;
          console.log('[GENUI][usage] extracted tokens:', { pt, ct });
          // Store only the last step's usage (not cumulative)
          if (typeof pt === 'number') lastStepPromptTokens = pt;
          if (typeof ct === 'number') lastStepCompletionTokens = ct;
        }
        console.log('[GENUI][usage] last step tokens:', { lastStepPromptTokens, lastStepCompletionTokens });

        // Determine if there are tool calls to execute
        const toolCallsToExecute = Array.from(toolState.values()).filter(t => t.name);
        if (!toolCallsToExecute.length) {
          // No tool calls → we are done; emit finish
          textDeferred.resolve(stepText);
          const finalUsage = { inputTokens: lastStepPromptTokens, outputTokens: lastStepCompletionTokens, promptTokens: lastStepPromptTokens, completionTokens: lastStepCompletionTokens };
          console.log('[GENUI][usage] resolving with (stop):', finalUsage);
          usageDeferred.resolve(finalUsage);
          yield { type: 'finish', finishReason: 'stop' } as any;
          break;
        }

        // Execute tools sequentially for deterministic side-effects
        const assistantToolCallsForHistory: any[] = [];
        const toolResultMessagesForHistory: any[] = [];
        for (const call of toolCallsToExecute) {
          const name = call.name as string;
          const id = call.id;
          let args: any = {};
          try { args = JSON.parse((call.argsText || '{}').trim().replace(/,+$/g, '')); } catch {}

          let result: any = null;
          if (name === 'create_new_window') {
            result = await tools.createNewWindow(String(args?.name || ''), String(args?.html || ''));
          } else if (name === 'dom_replace') {
            result = await tools.domReplace(String(args?.windowId || ''), Array.isArray(args?.mutations) ? args.mutations : []);
          } else if (name === 'update_window_title') {
            result = await tools.updateWindowTitle(String(args?.windowId || ''), String(args?.title || ''));
          } else if (name === 'set_window_html') {
            result = await tools.setWindowHtml(String(args?.windowId || ''), String(args?.html || ''));
          }

          aggregatedToolResults.push({ toolCallId: id, toolName: name, result });
          yield { type: 'tool-result', toolCallId: id, toolName: name, output: result } as any;

          // Build history messages for next step
          assistantToolCallsForHistory.push({ id, type: 'function', function: { name, arguments: JSON.stringify(args || {}) } });
          toolResultMessagesForHistory.push({ role: 'tool', tool_call_id: id, content: typeof result === 'string' ? result : JSON.stringify(result) });
        }

        // Append assistant tool_calls + tool results to messages
        messagesParam = [
          ...messagesParam,
          { role: 'assistant', content: null, tool_calls: assistantToolCallsForHistory },
          ...toolResultMessagesForHistory,
        ];

        yield { type: 'finish-step' } as any;

        // For next step: do not carry forward previously streamed assistant text; the model already consumed messagesParam
      }

      // If we exit loop without explicit finish, emit finish with length
      if (textDeferred) {
        textDeferred.resolve(finalTextForAllSteps || '');
      }
      const finalUsage = { inputTokens: lastStepPromptTokens, outputTokens: lastStepCompletionTokens, promptTokens: lastStepPromptTokens, completionTokens: lastStepCompletionTokens };
      console.log('[GENUI][usage] resolving with (length):', finalUsage);
      usageDeferred.resolve(finalUsage);
      toolResultsDeferred.resolve(aggregatedToolResults);
      yield { type: 'finish', finishReason: 'length' } as any;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try { toolResultsDeferred.resolve([]); } catch {}
      try { usageDeferred.resolve({ inputTokens: null, outputTokens: null }); } catch {}
      try { textDeferred.resolve(''); } catch {}
      yield { type: 'error', error: message } as any;
    }
  }

  const fullStream = (async function*() { for await (const e of generator()) yield e; })();
  const text = textDeferred.promise;
  const toolResults = toolResultsDeferred.promise;
  const totalUsage = usageDeferred.promise;
  return { fullStream, text, toolResults, totalUsage } as any;
}

