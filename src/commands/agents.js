import path from "node:path";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import pc from "picocolors";
import { renderRulesMarkdown } from "../agent/rules.js";
import { planSectionUpdate, SECTION_END, SECTION_START } from "../agent/section.js";
import { loadValidatedConfig } from "../config/loader.js";

export { SECTION_END, SECTION_START };

export const MCP_SERVER_ENTRY = { command: "npx", args: ["-y", "gitsmith", "mcp"] };

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes through a temporary file and a rename, so an interrupted run never
 * leaves a half-written AGENTS.md behind.
 */
export async function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.gitsmith-${process.pid}.tmp`;
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

const STATUS_STYLE = {
  created: pc.green,
  appended: pc.green,
  updated: pc.green,
  unchanged: pc.dim,
  "kept-edits": pc.yellow,
  malformed: pc.red
};

/**
 * Plans the .mcp.json change. Other servers are always kept, and a gitsmith entry
 * someone customized (another command, extra env) is kept unless forced.
 * @param {object | null} existing parsed .mcp.json, or null when missing
 * @param {{force?: boolean}} [options]
 * @returns {{status: "created" | "added" | "unchanged" | "kept-custom", config: object | null}}
 */
export function planMcpUpdate(existing, options = {}) {
  const config = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : null;
  const current = config?.mcpServers?.gitsmith;

  if (current && JSON.stringify(current) === JSON.stringify(MCP_SERVER_ENTRY)) {
    return { status: "unchanged", config: null };
  }
  if (current && !options.force) {
    return { status: "kept-custom", config: null };
  }
  return {
    status: config ? "added" : "created",
    config: { ...(config ?? {}), mcpServers: { ...(config?.mcpServers ?? {}), gitsmith: MCP_SERVER_ENTRY } }
  };
}

/**
 * Kept for callers that only need the merged object.
 * @param {object | null} existing
 */
export function withGitsmithServer(existing) {
  return planMcpUpdate(existing, { force: true }).config ?? existing;
}

/**
 * Writes the commit rules into agent instruction files (AGENTS.md by default) and,
 * with --mcp, registers the gitsmith MCP server in .mcp.json.
 *
 * Only the text between the gitsmith markers is ever touched; see agent/section.js.
 * @param {{file?: string[], mcp?: boolean, force?: boolean, print?: boolean}} options
 */
export async function runAgentsCommand(options = {}) {
  const { config, configPath } = await loadValidatedConfig();
  const section = renderRulesMarkdown(config);

  if (options.print) {
    process.stdout.write(`${SECTION_START}\n${section}\n${SECTION_END}\n`);
    return;
  }

  const root = path.dirname(configPath);
  const targets = options.file && options.file.length > 0 ? options.file : ["AGENTS.md"];
  let failed = false;

  for (const target of targets) {
    const filePath = path.resolve(root, target);
    const plan = planSectionUpdate(await readIfExists(filePath), section, { force: options.force });
    if (plan.content !== null) {
      await writeFileAtomic(filePath, plan.content);
    }
    const style = STATUS_STYLE[plan.status] ?? ((text) => text);
    console.log(style(`${path.relative(process.cwd(), filePath) || filePath}: ${plan.message}`));
    if (plan.status === "malformed") failed = true;
  }

  if (options.mcp) {
    const mcpPath = path.join(root, ".mcp.json");
    const raw = await readIfExists(mcpPath);
    let existing = null;
    if (raw !== null) {
      try {
        existing = JSON.parse(raw);
      } catch (error) {
        // Never overwrite a file we can't read back; the user may be mid-edit.
        console.log(pc.red(`.mcp.json is not valid JSON (${error instanceof Error ? error.message : error}); the file was not changed.`));
        failed = true;
      }
    }

    if (raw === null || existing !== null) {
      const plan = planMcpUpdate(existing, { force: options.force });
      if (plan.config) {
        await writeFileAtomic(mcpPath, `${JSON.stringify(plan.config, null, 2)}\n`);
        console.log(pc.green(`.mcp.json: registered the gitsmith MCP server (npx -y gitsmith mcp)`));
        console.log(pc.cyan("Claude Code, Cursor and other MCP clients that read .mcp.json now get gitsmith tools for this project."));
      } else if (plan.status === "unchanged") {
        console.log(pc.dim(".mcp.json: gitsmith is already registered"));
      } else {
        console.log(pc.yellow(".mcp.json: kept your custom gitsmith entry. Run with --force to replace it with the default."));
      }
    }
  }

  if (failed) process.exitCode = 1;
}
