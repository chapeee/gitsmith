import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { CONFIG_FILE_NAME, defaultConfig } from "../config/default.js";
import { resolveConfig } from "../config/resolve.js";
import { validateConfig } from "../config/schema.js";

/**
 * Creates the project config in the current directory: the default rules, or
 * with --from a config that extends shared rules (preset, file, URL or package).
 * @param {{force?: boolean, from?: string}} options
 */
export async function runInitCommand(options = {}) {
  // Always resolve against the invocation directory, not module location.
  const targetPath = path.resolve(process.cwd(), CONFIG_FILE_NAME);

  try {
    await access(targetPath, constants.F_OK);
    if (!options.force) {
      console.log(
        pc.yellow(
          `${CONFIG_FILE_NAME} already exists. Use "gitsmith init --force" to overwrite it.`
        )
      );
      return;
    }
  } catch {
    // File does not exist yet.
  }

  let content = defaultConfig;
  if (options.from) {
    content = { extends: options.from, ai: { enabled: true, askByDefault: true } };
    // Fail now, not on the first commit, if the shared rules can't be loaded or are invalid.
    const { config } = await resolveConfig(content, { configPath: targetPath });
    validateConfig(config);
  }

  // Pretty-print config to make first-time customization easy.
  await writeFile(targetPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  console.log(pc.green(`Created ${CONFIG_FILE_NAME} at ${targetPath}`));
  if (options.from) {
    console.log(pc.cyan(`It extends ${options.from}. Add keys to override them, or "scopes+": [...] to add scopes.`));
    console.log(pc.cyan('Run "gitsmith rules --resolved" to see the final rules and where each comes from.'));
  }
}
