import { readFile } from "node:fs/promises";
import { findUp } from "find-up";
import { CONFIG_FILE_NAME } from "./default.js";
import { validateConfig } from "./schema.js";

export async function findConfigPath() {
  return findUp(CONFIG_FILE_NAME, { type: "file" });
}

export async function loadValidatedConfig() {
  const configPath = await findConfigPath();
  if (!configPath) {
    throw new Error(
      `No ${CONFIG_FILE_NAME} found in this directory tree.\nRun "gitsmith init" in your project root to create one.`
    );
  }

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

  const config = validateConfig(json);
  return { config, configPath };
}
