import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import pc from "picocolors";
import { renderRulesMarkdown } from "../agent/rules.js";
import { loadValidatedConfig } from "../config/loader.js";

export const SECTION_START = "<!-- gitsmith:start -->";
export const SECTION_END = "<!-- gitsmith:end -->";

/**
 * Inserts or replaces the gitsmith section in a Markdown file's content.
 * Content outside the markers is left untouched.
 * @param {string | null} existing
 * @param {string} section
 */
export function upsertSection(existing, section) {
  const block = `${SECTION_START}\n${section}\n${SECTION_END}`;
  if (existing === null || existing.trim() === "") {
    return `${block}\n`;
  }

  const start = existing.indexOf(SECTION_START);
  const end = existing.indexOf(SECTION_END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + SECTION_END.length);
  }

  return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
}

/**
 * Writes the commit rules into agent instruction files (AGENTS.md by default),
 * so coding agents follow the format without being told.
 * @param {{file?: string[]}} options
 */
export async function runAgentsCommand(options = {}) {
  const { config, configPath } = await loadValidatedConfig();
  const root = path.dirname(configPath);
  const targets = options.file && options.file.length > 0 ? options.file : ["AGENTS.md"];
  const section = renderRulesMarkdown(config);

  for (const target of targets) {
    const filePath = path.resolve(root, target);
    let existing = null;
    try {
      existing = await readFile(filePath, "utf8");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") {
        throw error;
      }
    }

    await writeFile(filePath, upsertSection(existing, section), "utf8");
    console.log(pc.green(`${existing === null ? "Created" : "Updated"} commit rules in ${filePath}`));
  }
}
