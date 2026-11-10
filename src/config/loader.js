import { readFile } from "node:fs/promises";
import path from "node:path";
import { findUp } from "find-up";
import { CONFIG_FILE_NAME, LOCAL_CONFIG_FILE_NAME } from "./default.js";
import { ConfigResolveError, resolveConfig } from "./resolve.js";
import { validateConfig } from "./schema.js";

const aiDefaults = {
  provider: "nvidia",
  model: "nvidia/llama-3.3-nemotron-super-49b-v1",
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  askByDefault: true,
  allowNewScopes: true,
  // The agent reads the staged diff; set false to send only a typed description.
  sendDiff: true
};

/**
 * Finds the nearest config file by walking up parent directories.
 * @returns {Promise<string | undefined>}
 */
export async function findConfigPath() {
  return findUp(CONFIG_FILE_NAME, { type: "file" });
}

/**
 * Applies AI defaults only when AI is explicitly enabled.
 * Missing ai block remains feature-off for strict backward compatibility.
 * @param {object} config
 */
export function withAiDefaults(config) {
  if (!config.ai || config.ai.enabled !== true) {
    return config;
  }

  const ai = {
    ...aiDefaults,
    ...config.ai,
    enabled: true
  };

  // strictScopes means only listed scopes are valid, so AI must not invent new ones.
  if (config.strictScopes) {
    ai.allowNewScopes = false;
  }

  return { ...config, ai };
}

/**
 * Loads, parses, and validates project config.
 * @returns {Promise<{config: object, configPath: string}>}
 */
export async function loadValidatedConfig() {
  const configPath = await findConfigPath();
  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILE_NAME} found in this directory tree.\nRun "gitsmith init" in your project root to create one.`
    );
  }

  // Keep file-read and JSON-parse errors separate for clearer guidance.
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${CONFIG_FILE_NAME}: ${message}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${CONFIG_FILE_NAME}: ${message}`);
  }

  const localJson = await readLocalConfig(configPath);
  let resolved;
  try {
    resolved = await resolveConfig(json, { configPath, localJson });
  } catch (error) {
    if (error instanceof ConfigResolveError) {
      throw new Error(`${CONFIG_FILE_NAME}: ${error.message}`);
    }
    throw error;
  }

  const config = withAiDefaults(validateConfig(resolved.config));
  return { config, configPath, sources: resolved.sources, chain: resolved.chain, warnings: resolved.warnings };
}

/**
 * Reads the optional personal .commitconfig.local.json next to the project config.
 * @param {string} configPath
 * @returns {Promise<object | null>}
 */
async function readLocalConfig(configPath) {
  const localPath = path.join(path.dirname(configPath), LOCAL_CONFIG_FILE_NAME);
  let raw;
  try {
    raw = await readFile(localPath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${LOCAL_CONFIG_FILE_NAME}: ${message}`);
  }
}
