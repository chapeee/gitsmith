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
 * Returns absolute git repository root path.
 * @returns {Promise<string>}
 */
export async function getRepoRoot() {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
    const root = stdout.trim();
    if (!root) {
      throw new Error("empty git root");
    }
    return root;
  } catch {
    throw new Error("Could not resolve git repository root.");
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
 * Creates a git commit with the provided header message.
 * @param {string} message
 * @returns {Promise<{output: string, hash: string | null}>}
 */
export async function createCommit(message) {
  const { stdout } = await execa("git", ["commit", "-m", message]);
  const hashMatch = stdout.match(/\[[^\]]+\s([a-f0-9]{7,40})\]/i);
  return {
    output: stdout,
    hash: hashMatch?.[1] ?? null
  };
}
