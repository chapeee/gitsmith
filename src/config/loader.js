import { readFile } from "node:fs/promises";
import { findUp } from "find-up";
import { CONFIG_FILE_NAME } from "./default.js";
import { validateConfig } from "./schema.js";

const aiDefaults = {
  provider: "nvidia",
  model: "nvidia/llama-3.3-nemotron-super-49b-v1",
  endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
  askByDefault: true,
  allowNewScopes: true
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

  return {
    ...config,
    ai: {
      ...aiDefaults,
      ...config.ai,
      enabled: true
    }
  };
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

  const config = withAiDefaults(validateConfig(json));
  return { config, configPath };
}
