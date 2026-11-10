import { writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { describeRules, renderRulesMarkdown } from "../agent/rules.js";
import { loadValidatedConfig } from "../config/loader.js";

// Keys that make sense to share; "ai" is machine-specific and stays out of exports.
const SHAREABLE_KEYS = [
  "types",
  "askScope",
  "scopes",
  "strictScopes",
  "askTicket",
  "ticketPrefix",
  "askBreaking",
  "format",
  "headerMaxLength",
  "messageStyle"
];

/**
 * The resolved rules as a standalone, shareable file (no "extends", no "ai").
 * @param {object} config
 */
export function toShareableRules(config) {
  return Object.fromEntries(SHAREABLE_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
}

/**
 * Prints the commit rules: Markdown by default, JSON with --json, and with
 * --resolved the extends chain plus which file set each value.
 * @param {{json?: boolean, resolved?: boolean}} options
 */
export async function runRulesCommand(options = {}) {
  const { config, sources, chain, warnings } = await loadValidatedConfig();

  if (options.resolved) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ chain, sources, config: toShareableRules(config) }, null, 2)}\n`);
      return;
    }
    console.log(pc.cyan(`Applied in order: ${chain.join(" → ")}`));
    const rules = toShareableRules(config);
    const width = Math.max(...Object.keys(rules).map((key) => key.length));
    for (const [key, value] of Object.entries(rules)) {
      const source = sources?.[key] ?? "default";
      console.log(`${key.padEnd(width)}  ${JSON.stringify(value)}  ${pc.dim(`← ${source}`)}`);
    }
    for (const warning of warnings ?? []) console.log(pc.yellow(`Warning: ${warning}`));
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(describeRules(config), null, 2)}\n`);
    return;
  }
  console.log(renderRulesMarkdown(config));
}

/**
 * Writes the resolved rules as one shareable JSON file (or prints them).
 * Teams publish this file and other repos "extends" it.
 * @param {{out?: string}} options
 */
export async function runRulesExportCommand(options = {}) {
  const { config } = await loadValidatedConfig();
  const content = `${JSON.stringify(toShareableRules(config), null, 2)}\n`;
  if (!options.out) {
    process.stdout.write(content);
    return;
  }
  const target = path.resolve(process.cwd(), options.out);
  await writeFile(target, content, "utf8");
  console.log(pc.green(`Wrote shareable rules to ${target}`));
  console.log(pc.cyan(`Other repos can use them with: { "extends": "<path, URL or package of this file>" }`));
}
