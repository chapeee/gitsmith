import enquirer from "enquirer";
import pc from "picocolors";
import {
  getProviderApiKey,
  getProviderStatus,
  removeProviderApiKey,
  saveProviderApiKey
} from "../ai/credentials.js";

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

export async function resolveApiKeyWithoutPrompt() {
  const found = await getProviderApiKey();
  if (found?.apiKey) {
    return found.apiKey;
  }
  return null;
}

export async function runKeySetCommand(keyArg) {
  let key = String(keyArg ?? "").trim();
  if (!key) {
    const entered = await ask({
      type: "password",
      name: "apiKey",
      message: "Paste your NVIDIA API key:",
      initial: ""
    });
    key = String(entered ?? "").trim();
  }

  if (!key) {
    console.log(pc.yellow("No key provided. Nothing saved."));
    return;
  }

  await saveProviderApiKey(key);
  console.log(pc.green("Key saved successfully."));
}

export async function runKeyShowCommand() {
  const status = await getProviderStatus();
  if (!status.hasKey) {
    console.log("No key saved.");
    return;
  }
  console.log(status.maskedKey);
}

export async function runKeyRemoveCommand() {
  const confirmed = await ask({
    type: "confirm",
    name: "confirmed",
    message: "Are you sure?",
    initial: false
  });
  if (!confirmed) {
    console.log(pc.yellow("Action cancelled."));
    return;
  }

  const removed = await removeProviderApiKey();
  if (!removed) {
    console.log("No key saved.");
    return;
  }

  console.log(pc.green("Key removed."));
}

export async function runKeyStatusCommand() {
  const status = await getProviderStatus();
  if (!status.hasKey) {
    console.log("No key saved.");
    return;
  }

  console.log(`Provider: ${status.provider}`);
  console.log(`Source: ${status.source}`);
  console.log(`Saved at: ${status.savedAt ?? "n/a (env override)"}`);
}
