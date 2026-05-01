import enquirer from "enquirer";
import pc from "picocolors";
import { getProviderApiKey, getProviderModel, saveProviderModel } from "../ai/credentials.js";
import { DEFAULT_BASE_URL, DEFAULT_MODEL_ID, MODEL_REGISTRY, getModelById } from "../ai/models.js";

const { prompt } = enquirer;

function isPromptCancelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|canceled|cancelled|sigint/i.test(message);
}

async function ask(question) {
  try {
    const response = await prompt(question);
    return response[question.name];
  } catch (error) {
    if (isPromptCancelError(error)) {
      console.log(pc.yellow("Action cancelled."));
      process.exit(0);
    }
    throw error;
  }
}

function formatModelRow(model) {
  return `${model.id} | ${model.name} | ${model.contextWindow} | ${model.speedTier} | ${model.useCase} | ${model.description}`;
}

async function askModelSelection(currentModelId) {
  const choices = MODEL_REGISTRY.map((model) => ({
    name: model.id,
    message: `${model.name} - ${model.description} [${model.contextWindow}, ${model.speedTier}]`,
    hint: model.description
  }));

  const initialIndex = Math.max(
    0,
    MODEL_REGISTRY.findIndex((entry) => entry.id === currentModelId)
  );

  return ask({
    type: "select",
    name: "modelId",
    message: "Select default NVIDIA model",
    choices,
    initial: initialIndex
  });
}

async function pingModel(model, apiKey) {
  const endpoint = model.baseUrl ?? DEFAULT_BASE_URL;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: "You are a health check." },
          { role: "user", content: "Reply with OK." }
        ],
        max_tokens: 4,
        temperature: 0.2,
        stream: false
      })
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

export async function runModelListCommand() {
  console.log(pc.cyan("Available NVIDIA models:"));
  console.log("model-id | name | context | speed | use-case | description");
  for (const model of MODEL_REGISTRY) {
    console.log(formatModelRow(model));
  }
}

export async function runModelCurrentCommand() {
  const savedModel = await getProviderModel();
  const modelId = savedModel?.model ?? DEFAULT_MODEL_ID;
  const model = getModelById(modelId) ?? getModelById(DEFAULT_MODEL_ID);
  console.log(`Current model: ${model.id}`);
  console.log(`Name: ${model.name}`);
  console.log(`Context: ${model.contextWindow}`);
  console.log(`Speed: ${model.speedTier}`);
}

export async function runModelSetCommand(modelId) {
  const target = String(modelId ?? "").trim();
  const model = getModelById(target);
  if (!model) {
    throw new Error(`Unknown model "${target}". Run "gitsmith model list" to see supported models.`);
  }
  await saveProviderModel(model.id);
  console.log(pc.green(`Default model saved: ${model.id}`));
}

export async function runModelPickCommand() {
  const current = await getProviderModel();
  const currentId = current?.model ?? DEFAULT_MODEL_ID;
  const selectedId = await askModelSelection(currentId);
  await runModelSetCommand(selectedId);
}

export async function runModelSwitchCommand() {
  const keyRecord = await getProviderApiKey();
  if (!keyRecord?.apiKey) {
    console.log(pc.yellow("No NVIDIA API key found."));
    console.log('Add your key first: gitsmith key:set [key]');
    return;
  }

  while (true) {
    const current = await getProviderModel();
    const currentId = current?.model ?? DEFAULT_MODEL_ID;
    const selectedId = await askModelSelection(currentId);
    const selectedModel = getModelById(selectedId);
    if (!selectedModel) {
      console.log(pc.yellow(`Unknown model "${selectedId}". Please select again.`));
      continue;
    }

    console.log(pc.cyan(`Checking model availability: ${selectedModel.id}`));
    const probe = await pingModel(selectedModel, keyRecord.apiKey);
    if (probe.ok) {
      await saveProviderModel(selectedModel.id);
      console.log(pc.green(`Model switched successfully: ${selectedModel.id}`));
      return;
    }

    const statusText = probe.status ? `HTTP ${probe.status}` : "network error";
    console.log(pc.yellow(`Selected model is not available right now (${statusText}).`));
    const retry = await ask({
      type: "confirm",
      name: "retry",
      message: "Select another model?",
      initial: true
    });
    if (!retry) {
      console.log(pc.yellow("Model switch cancelled."));
      return;
    }
  }
}
