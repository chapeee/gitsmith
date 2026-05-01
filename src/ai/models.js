export const DEFAULT_MODEL_ID = "nvidia/llama-3.3-nemotron-super-49b-v1";
export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export const MODEL_REGISTRY = [
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1",
    name: "Nemotron Super 31B",
    description: "Balanced speed + quality for commit generation",
    contextWindow: "128K",
    speedTier: "fast",
    useCase: "default"
  },
  {
    id: "deepseek-ai/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description: "Huge context for large multi-file commit context",
    contextWindow: "1M",
    speedTier: "fast",
    useCase: "large-context"
  },
  {
    id: "mistralai/devstral-2-123b-instruct-2512",
    name: "Devstral 2 123B Instruct",
    description: "Mistral coding model, strong for code explanation and generation",
    contextWindow: "128K",
    speedTier: "medium",
    useCase: "coding"
  }
];

export function getModelById(modelId) {
  const id = String(modelId ?? "").trim();
  return MODEL_REGISTRY.find((entry) => entry.id === id) ?? null;
}

export function listModelIds() {
  return MODEL_REGISTRY.map((entry) => entry.id);
}

export function resolveModelSelection(savedModelId, configModelId, overrideModelId) {
  const candidate =
    String(overrideModelId ?? "").trim() ||
    String(savedModelId ?? "").trim() ||
    String(configModelId ?? "").trim() ||
    DEFAULT_MODEL_ID;

  const model = getModelById(candidate);
  if (!model) {
    return {
      model: getModelById(DEFAULT_MODEL_ID),
      resolvedFrom: "default",
      warning: `Unknown model "${candidate}". Falling back to default model "${DEFAULT_MODEL_ID}".`
    };
  }

  if (String(overrideModelId ?? "").trim()) {
    return { model, resolvedFrom: "override", warning: null };
  }
  if (String(savedModelId ?? "").trim()) {
    return { model, resolvedFrom: "saved", warning: null };
  }
  if (String(configModelId ?? "").trim()) {
    return { model, resolvedFrom: "config", warning: null };
  }
  return { model, resolvedFrom: "default", warning: null };
}
