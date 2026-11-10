import path from "node:path";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import pc from "picocolors";
import { ensureInsideGitRepo, getHooksDir } from "../git/executor.js";

export const HOOK_MARKER = "# gitsmith-managed commit-msg hook";

// Prefers a project-local install, then a global one; never blocks when gitsmith is missing.
export const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Checks every commit message against .commitconfig.json, whoever makes the commit.
# Remove with: gitsmith hook uninstall
if [ -x "./node_modules/.bin/gitsmith" ]; then
  exec ./node_modules/.bin/gitsmith check --file "$1"
elif command -v gitsmith >/dev/null 2>&1; then
  exec gitsmith check --file "$1"
else
  echo "gitsmith not found; skipping commit message check." >&2
  exit 0
fi
`;

async function resolveHookPath() {
  await ensureInsideGitRepo();
  const hooksDir = path.resolve(process.cwd(), await getHooksDir());
  return path.join(hooksDir, "commit-msg");
}

async function readExisting(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Installs the commit-msg hook. Refuses to replace a hook gitsmith did not write unless --force.
 * @param {{force?: boolean}} options
 */
export async function runHookInstallCommand(options = {}) {
  const hookPath = await resolveHookPath();
  const existing = await readExisting(hookPath);

  if (existing !== null && !existing.includes(HOOK_MARKER) && !options.force) {
    throw new Error(
      `A commit-msg hook already exists at ${hookPath}. Use "gitsmith hook install --force" to replace it.`
    );
  }

  await mkdir(path.dirname(hookPath), { recursive: true });
  await writeFile(hookPath, HOOK_SCRIPT, "utf8");
  await chmod(hookPath, 0o755);
  console.log(pc.green(`Installed commit-msg hook at ${hookPath}`));
  console.log(pc.cyan("Every commit message is now checked against .commitconfig.json."));
}

/**
 * Removes the commit-msg hook, only when gitsmith wrote it.
 */
export async function runHookUninstallCommand() {
  const hookPath = await resolveHookPath();
  const existing = await readExisting(hookPath);

  if (existing === null) {
    console.log("No commit-msg hook installed.");
    return;
  }
  if (!existing.includes(HOOK_MARKER)) {
    throw new Error(`The commit-msg hook at ${hookPath} was not written by gitsmith; leaving it alone.`);
  }

  await rm(hookPath);
  console.log(pc.green("Removed gitsmith commit-msg hook."));
}
