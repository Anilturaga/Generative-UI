import { useState, useEffect, useMemo } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getApiKey,
  setApiKey,
  type AIProvider,
  getSelectedProvider,
  setSelectedProvider,
  MODEL_OPTIONS,
  getSelectedModel,
  setSelectedModel,
  getDefaultModel,
} from "@/lib/utils";

export interface ApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSave?: (provider: AIProvider, apiKey: string) => void;
}

export function ApiKeyDialog({ open, onClose, onSave }: ApiKeyDialogProps) {
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [modelId, setModelId] = useState<string>("");

  useEffect(() => {
    if (open) {
      const savedProvider = getSelectedProvider() || "openai";
      setProvider(savedProvider);
      const existing = getApiKey(savedProvider);
      if (existing) setApiKeyValue(existing);
      const initialModel = getSelectedModel(savedProvider) || getDefaultModel(savedProvider);
      setModelId(initialModel);
    }
  }, [open]);

  const existingKey = useMemo(() => getApiKey(provider) || "", [provider, open]);
  const canSave = (existingKey && existingKey.length > 0) || apiKeyValue.trim().length > 0;

  const handleSave = () => {
    // Require a key only if none exists for the provider
    const entered = apiKeyValue.trim();
    if (!existingKey && !entered) return;
    setSelectedProvider(provider);
    if (entered) {
      setApiKey(provider, entered);
    }
    if (modelId) setSelectedModel(provider, modelId);
    onSave?.(provider, entered || existingKey);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Choose model provider and enter API key"
      description="Keys are stored only in this browser's localStorage."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium w-28">Provider</label>
          <select
            className="select select-bordered h-10 min-h-0"
            value={provider}
            onChange={(e) => {
              const p = e.target.value as AIProvider;
              setProvider(p);
              const key = getApiKey(p);
              setApiKeyValue(key || "");
              const m = getSelectedModel(p) || getDefaultModel(p);
              setModelId(m);
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            {/* <option value="gemini">Gemini</option> */}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium w-28">Model</label>
          <select
            className="select select-bordered h-10 min-h-0 flex-1"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            {MODEL_OPTIONS[provider].map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <Input
          type="password"
          placeholder={provider === "openai" ? "sk-..." : provider === "anthropic" ? "sk-ant-..." : "AIza..."}
          value={apiKeyValue}
          onChange={(e) => setApiKeyValue(e.target.value)}
          className="w-full"
        />
        {!canSave ? (
          <p className="text-xs text-stone-500">Enter an API key to enable this provider.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave} className="btn bg-amber-700 hover:bg-amber-800 text-white shadow-md hover:shadow-lg active:scale-95 border-none">Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default ApiKeyDialog;


