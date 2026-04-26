import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { CONFIG_FILE_NAME, defaultConfig } from "../config/default.js";

export async function runInitCommand(options = {}) {
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

  await writeFile(targetPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  console.log(pc.green(`Created ${CONFIG_FILE_NAME} at ${targetPath}`));
}
