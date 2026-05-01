import os from "node:os";
import path from "node:path";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const PROVIDER = "nvidia";
const KEY_ENV_NAME = "GITSMITH_AI_KEY";
const MODEL_ENV_NAME = "GITSMITH_AI_MODEL";

export class CredentialsReadError extends Error {}

export function getCredentialsPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".gitsmith", "credentials.json");
}

function isWindows() {
  return process.platform === "win32";
}

export function maskApiKey(value) {
  const key = String(value ?? "").trim();
  if (key.length <= 8) {
    return `${key.slice(0, 2)}****`;
  }
  return `${key.slice(0, 10)}${"*".repeat(Math.max(4, key.length - 14))}${key.slice(-4)}`;
}

async function ensureCredentialsDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readCredentialsFile({ homeDir } = {}) {
  const filePath = getCredentialsPath(homeDir);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    const e = /** @type {NodeJS.ErrnoException} */ (error);
    if (e.code === "ENOENT") {
      return {};
    }
    throw new CredentialsReadError("Could not read ~/.gitsmith/credentials.json.");
  }
}

export async function writeCredentialsFile(data, { homeDir } = {}) {
  const filePath = getCredentialsPath(homeDir);
  await ensureCredentialsDir(filePath);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (!isWindows()) {
    await chmod(filePath, 0o600);
  }
  return filePath;
}

export async function saveProviderApiKey(apiKey, { homeDir } = {}) {
  const credentials = await readCredentialsFile({ homeDir });
  credentials[PROVIDER] = {
    apiKey: String(apiKey).trim(),
    savedAt: new Date().toISOString()
  };
  await writeCredentialsFile(credentials, { homeDir });
}

export async function saveProviderModel(model, { homeDir } = {}) {
  const credentials = await readCredentialsFile({ homeDir });
  const previous = credentials[PROVIDER] ?? {};
  credentials[PROVIDER] = {
    ...previous,
    model: String(model).trim(),
    modelSavedAt: new Date().toISOString()
  };
  await writeCredentialsFile(credentials, { homeDir });
}

export async function getProviderModel({ homeDir } = {}) {
  const fromEnv = (process.env[MODEL_ENV_NAME] ?? "").trim();
  if (fromEnv) {
    return { model: fromEnv, source: "env", provider: PROVIDER, savedAt: null };
  }

  const credentials = await readCredentialsFile({ homeDir });
  const providerRecord = credentials[PROVIDER];
  const fromFile = String(providerRecord?.model ?? "").trim();
  if (fromFile) {
    return {
      model: fromFile,
      source: "file",
      provider: PROVIDER,
      savedAt: providerRecord?.modelSavedAt ?? providerRecord?.savedAt ?? null
    };
  }
  return null;
}

export async function removeProviderApiKey({ homeDir } = {}) {
  const credentials = await readCredentialsFile({ homeDir });
  if (!credentials[PROVIDER]) {
    return false;
  }
  delete credentials[PROVIDER];

  const hasEntries = Object.keys(credentials).length > 0;
  if (hasEntries) {
    await writeCredentialsFile(credentials, { homeDir });
  } else {
    const filePath = getCredentialsPath(homeDir);
    await rm(filePath, { force: true });
  }
  return true;
}

export async function getProviderApiKey({ homeDir } = {}) {
  const fromEnv = (process.env[KEY_ENV_NAME] ?? "").trim();
  if (fromEnv) {
    return { apiKey: fromEnv, source: "env", provider: PROVIDER, savedAt: null };
  }

  const credentials = await readCredentialsFile({ homeDir });
  const providerRecord = credentials[PROVIDER];
  const fromFile = String(providerRecord?.apiKey ?? "").trim();
  if (fromFile) {
    return {
      apiKey: fromFile,
      source: "file",
      provider: PROVIDER,
      savedAt: providerRecord?.savedAt ?? null
    };
  }
  return null;
}

export async function getProviderStatus({ homeDir } = {}) {
  const fromEnv = (process.env[KEY_ENV_NAME] ?? "").trim();
  if (fromEnv) {
    return {
      hasKey: true,
      provider: PROVIDER,
      source: "env",
      savedAt: null,
      maskedKey: maskApiKey(fromEnv)
    };
  }

  const credentials = await readCredentialsFile({ homeDir });
  const providerRecord = credentials[PROVIDER];
  const fileKey = String(providerRecord?.apiKey ?? "").trim();
  if (!fileKey) {
    return { hasKey: false, provider: PROVIDER, source: null, savedAt: null, maskedKey: null };
  }

  return {
    hasKey: true,
    provider: PROVIDER,
    source: "file",
    savedAt: providerRecord?.savedAt ?? null,
    maskedKey: maskApiKey(fileKey)
  };
}
