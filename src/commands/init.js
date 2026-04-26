import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { CONFIG_FILE_NAME, defaultConfig } from "../config/default.js";

/**
 * Creates the default project config in the current directory.
 * @param {{force?: boolean}} options
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

  // Pretty-print config to make first-time customization easy.
  await writeFile(targetPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  console.log(pc.green(`Created ${CONFIG_FILE_NAME} at ${targetPath}`));
}
