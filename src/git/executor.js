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
 * Lists every changed path (staged, unstaged and untracked).
 * @returns {Promise<string[]>}
 */
export async function getChangedFiles() {
  const { stdout } = await execa("git", ["status", "--porcelain", "--untracked-files=all"]);
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());
}

/**
 * Stages all changes, like `git add -A`.
 */
export async function stageAll() {
  await execa("git", ["add", "-A"]);
}

// Generated files say little about intent and would crowd out the real changes.
const DIFF_EXCLUDES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.map"
].map((pattern) => `:(exclude,glob)**/${pattern}`);

/**
 * Returns the staged change as a file summary plus a size-capped diff, for AI context.
 * @param {{maxChars?: number}} [options]
 * @returns {Promise<{stat: string, diff: string, truncated: boolean}>}
 */
export async function getStagedDiff(options = {}) {
  const maxChars = options.maxChars ?? 12000;
  const { stdout: stat } = await execa("git", ["diff", "--cached", "--stat"]);
  const { stdout: diff } = await execa("git", ["diff", "--cached", "--no-color", "-U2", "--", ".", ...DIFF_EXCLUDES]);
  const truncated = diff.length > maxChars;
  return {
    stat: stat.trim(),
    diff: truncated ? `${diff.slice(0, maxChars)}\n[diff truncated]` : diff,
    truncated
  };
}

const PERSON_PATTERN = /^[^<>\n]+ <[^<>\s]+@[^<>\s]+>$/;

/**
 * True for "Name <email@example.com>", the shape git expects for authors and trailers.
 * @param {string} value
 */
export function isValidPerson(value) {
  return PERSON_PATTERN.test(String(value ?? "").trim());
}

/**
 * Joins a body and Co-Authored-By trailers; trailers must be the last paragraph.
 * @param {string | undefined} body
 * @param {string[] | undefined} coAuthors
 */
export function buildCommitBody(body, coAuthors) {
  const text = String(body ?? "").trim();
  const trailers = (coAuthors ?? [])
    .map((person) => String(person).trim())
    .filter(Boolean)
    .map((person) => `Co-Authored-By: ${person}`)
    .join("\n");
  return [text, trailers].filter(Boolean).join("\n\n");
}

/**
 * Creates a git commit with the provided header, optional body, co-authors and author.
 * The committer stays whoever is configured in git; `author` only changes the author.
 * @param {string} message
 * @param {{body?: string, coAuthors?: string[], author?: string, paths?: string[]}} [options]
 * @returns {Promise<{output: string, hash: string | null}>}
 */
export async function createCommit(message, options = {}) {
  const args = ["commit", "-m", message];
  const body = buildCommitBody(options.body, options.coAuthors);
  if (body) {
    args.push("-m", body);
  }
  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  const paths = options.paths ?? [];
  if (paths.length > 0) {
    // Stage new files too, then commit exactly these paths; anything else staged stays staged.
    await execa("git", ["add", "--", ...paths]);
    args.push("--", ...paths);
  }
  const { stdout } = await execa("git", args);
  const hashMatch = stdout.match(/\[[^\]]+\s([a-f0-9]{7,40})\]/i);
  return {
    output: stdout,
    hash: hashMatch?.[1] ?? null
  };
}

/**
 * Structured working-tree status for agents: branch, staged / unstaged / untracked
 * files with git's status letter, and the latest commit subjects (to match their style).
 * @returns {Promise<{branch: string, staged: {path: string, status: string}[],
 *   unstaged: {path: string, status: string}[], untracked: string[], recentCommits: string[]}>}
 */
export async function getRepoStatus() {
  const { stdout: branchOut } = await execa("git", ["symbolic-ref", "--short", "-q", "HEAD"], { reject: false });
  const { stdout } = await execa("git", ["status", "--porcelain=v1", "--untracked-files=all"]);

  const staged = [];
  const unstaged = [];
  const untracked = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const x = line[0];
    const y = line[1];
    // Renames look like "old -> new"; agents act on the new path.
    const filePath = line.slice(3).split(" -> ").pop().trim();
    if (x === "?" && y === "?") {
      untracked.push(filePath);
      continue;
    }
    if (x !== " ") staged.push({ path: filePath, status: x });
    if (y !== " ") unstaged.push({ path: filePath, status: y });
  }

  const log = await execa("git", ["log", "-5", "--format=%s"], { reject: false });
  const recentCommits = log.exitCode === 0 ? log.stdout.split("\n").filter(Boolean) : [];

  return { branch: branchOut.trim() || "(detached)", staged, unstaged, untracked, recentCommits };
}

/**
 * Diff for agents: staged changes, or for specific paths (staged or not).
 * @param {{paths?: string[], maxChars?: number}} [options]
 */
export async function getDiffForPaths(options = {}) {
  const paths = options.paths ?? [];
  if (paths.length === 0) {
    return getStagedDiff({ maxChars: options.maxChars });
  }
  const maxChars = options.maxChars ?? 12000;
  // HEAD may not exist yet in a new repo; fall back to the index.
  const hasHead = (await execa("git", ["rev-parse", "--verify", "-q", "HEAD"], { reject: false })).exitCode === 0;
  const base = hasHead ? ["HEAD"] : ["--cached"];
  const { stdout: stat } = await execa("git", ["diff", ...base, "--stat", "--", ...paths]);
  const { stdout: diff } = await execa("git", ["diff", ...base, "--no-color", "-U2", "--", ...paths]);
  const truncated = diff.length > maxChars;
  return { stat: stat.trim(), diff: truncated ? `${diff.slice(0, maxChars)}\n[diff truncated]` : diff, truncated };
}
