import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type AIProvider = "openai" | "anthropic" | "gemini";
export const LOCAL_STORAGE_PROVIDER = "ai_provider";
export const LOCAL_STORAGE_API_KEYS = "ai_api_keys"; // JSON map { provider: key }
export const LOCAL_STORAGE_SELECTED_MODELS = "ai_selected_models"; // JSON map { provider: modelId }

// Model options per provider (id = model identifier used by SDK providers)
export const MODEL_OPTIONS: Record<AIProvider, Array<{ id: string; label: string }>> = {
  openai: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  // gemini: [
  //   { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  //   { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  //   { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  // ],
};

export function getDefaultModel(provider: AIProvider): string {
  if (provider === "openai") return "gpt-5";
  if (provider === "anthropic") return "claude-3-5-haiku-20241022"; // fallback aligns with MODEL_OPTIONS
  return "gemini-2.5-pro";
}

export function getSelectedModel(provider: AIProvider): string | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SELECTED_MODELS);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[provider] || null;
  } catch (_e) {
    return null;
  }
}

export function setSelectedModel(provider: AIProvider, modelId: string) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SELECTED_MODELS);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[provider] = modelId;
    localStorage.setItem(LOCAL_STORAGE_SELECTED_MODELS, JSON.stringify(map));
  } catch (_e) {
    // noop
  }
}

export function getSelectedProvider(): AIProvider | null {
  try {
    return (localStorage.getItem(LOCAL_STORAGE_PROVIDER) as AIProvider) || null;
  } catch (_e) {
    return null;
  }
}

export function setSelectedProvider(provider: AIProvider) {
  try {
    localStorage.setItem(LOCAL_STORAGE_PROVIDER, provider);
  } catch (_e) {
    // noop
  }
}

export function getApiKey(provider: AIProvider): string | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_API_KEYS);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[provider] || null;
  } catch (_e) {
    return null;
  }
}

export function setApiKey(provider: AIProvider, key: string) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_API_KEYS);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[provider] = key;
    localStorage.setItem(LOCAL_STORAGE_API_KEYS, JSON.stringify(map));
  } catch (_e) {
    // noop
  }
}

export function deleteApiKey(provider: AIProvider) {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_API_KEYS);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, string>;
    if (provider in map) {
      delete map[provider];
      const keys = Object.keys(map);
      if (keys.length === 0) {
        localStorage.removeItem(LOCAL_STORAGE_API_KEYS);
        localStorage.removeItem(LOCAL_STORAGE_PROVIDER);
      } else {
        localStorage.setItem(LOCAL_STORAGE_API_KEYS, JSON.stringify(map));
        // If the selected provider had its key deleted, also clear selection
        const selected = getSelectedProvider();
        if (selected === provider) {
          localStorage.removeItem(LOCAL_STORAGE_PROVIDER);
        }
      }
    }
  } catch (_e) {
    // noop
  }
}

export function isAuthError(error: unknown): boolean {
  const message = (error && (error as any).message) as string | undefined;
  const status = (error && (error as any).status) as number | undefined;
  const code = (error && (error as any).code) as string | undefined;
  if (status && (status === 401 || status === 403)) return true;
  if (code && ["invalid_api_key", "unauthorized", "permission_denied"].includes(code)) return true;
  if (message) {
    const m = message.toLowerCase();
    if (
      m.includes("invalid api key") ||
      m.includes("incorrect api key") ||
      m.includes("unauthorized") ||
      m.includes("401") ||
      m.includes("forbidden")
    ) {
      return true;
    }
  }
  return false;
}

