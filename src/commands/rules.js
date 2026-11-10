import { describeRules, renderRulesMarkdown } from "../agent/rules.js";
import { loadValidatedConfig } from "../config/loader.js";

/**
 * Prints the project's commit rules, as Markdown or as JSON (--json).
 * @param {{json?: boolean}} options
 */
export async function runRulesCommand(options = {}) {
  const { config } = await loadValidatedConfig();
  if (options.json) {
    process.stdout.write(`${JSON.stringify(describeRules(config), null, 2)}\n`);
    return;
  }
  console.log(renderRulesMarkdown(config));
}
