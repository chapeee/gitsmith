import { execa } from "execa";

/**
 * Ensures command runs inside a git work tree.
 */
export async function ensureInsideGitRepo() {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--is-inside-work-tree"]);
    if (stdout.trim() !== "true") {
      throw new Error("Not inside a git work tree.");
    }
  } catch {
    throw new Error("This command must be run inside a git repository.");
  }
}

/**
 * Ensures there are staged changes ready to commit.
 */
export async function ensureStagedFiles() {
  try {
    const { stdout } = await execa("git", ["diff", "--cached", "--name-only"]);
    if (!stdout.trim()) {
      throw new Error("no staged files");
    }
  } catch {
    throw new Error("No staged files found. Stage files first with: git add <files>");
  }
}

/**
 * Lists staged file paths.
 * @returns {Promise<string[]>}
 */
export async function getStagedFiles() {
  const { stdout } = await execa("git", ["diff", "--cached", "--name-only"]);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Resolves the hooks directory, honouring core.hooksPath and worktrees.
 * @returns {Promise<string>}
 */
export async function getHooksDir() {
  const { stdout } = await execa("git", ["rev-parse", "--git-path", "hooks"]);
  return stdout.trim();
}

/**
 * Creates a git commit with the provided header and optional body.
 * @param {string} message
 * @param {{body?: string}} [options]
 * @returns {Promise<{output: string, hash: string | null}>}
 */
export async function createCommit(message, options = {}) {
  const args = ["commit", "-m", message];
  const body = String(options.body ?? "").trim();
  if (body) {
    args.push("-m", body);
  }
  const { stdout } = await execa("git", args);
  const hashMatch = stdout.match(/\[[^\]]+\s([a-f0-9]{7,40})\]/i);
  return {
    output: stdout,
    hash: hashMatch?.[1] ?? null
  };
}
