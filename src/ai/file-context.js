import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

function trimMentionPath(token) {
  return String(token ?? "")
    .replace(/^[`"'(\[]+/, "")
    .replace(/[`"')\],.;:!?]+$/g, "")
    .trim();
}

export function extractMentionedFiles(text) {
  const input = String(text ?? "");
  const mentionRegex = /(^|\s)@([^\s@]+)/g;
  const mentioned = [];

  for (const match of input.matchAll(mentionRegex)) {
    const mentionPath = trimMentionPath(match[2]);
    if (mentionPath) {
      mentioned.push(mentionPath);
    }
  }

  const cleaned = input
    .replace(mentionRegex, (_full, leading) => leading)
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    mentioned,
    cleaned
  };
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveMentionPath(repoRoot, mentionPath) {
  const normalized = String(mentionPath ?? "").replaceAll("\\", "/");
  if (!normalized || path.isAbsolute(normalized)) {
    return null;
  }

  const rootPath = path.resolve(repoRoot);
  const withoutDot = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  const resolvedPath = path.resolve(rootPath, withoutDot);
  if (!isPathInsideRoot(rootPath, resolvedPath)) {
    return null;
  }

  return resolvedPath;
}

export async function getRepositoryFileIndex(repoRoot) {
  const { stdout } = await execa("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot
  });

  const files = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const withTimes = await Promise.all(
    files.map(async (relativePath) => {
      const absolutePath = path.join(repoRoot, relativePath);
      try {
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
          return null;
        }
        return {
          relativePath: relativePath.replaceAll("\\", "/"),
          mtimeMs: fileStat.mtimeMs
        };
      } catch {
        return null;
      }
    })
  );

  return withTimes
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.relativePath);
}

function fuzzyScore(query, candidate) {
  const q = String(query ?? "").toLowerCase();
  const c = String(candidate ?? "").toLowerCase();
  if (!q) {
    return 1;
  }

  let score = 0;
  let lastIndex = -1;
  for (const char of q) {
    const index = c.indexOf(char, lastIndex + 1);
    if (index === -1) {
      return -1;
    }
    score += index === lastIndex + 1 ? 8 : 2;
    if (index === 0 || c[index - 1] === "/" || c[index - 1] === "-" || c[index - 1] === "_") {
      score += 6;
    }
    lastIndex = index;
  }

  if (c.includes(q)) {
    score += 18;
  }

  return score;
}

export function suggestMentionedFiles(allFiles, rawQuery, limit = 12) {
  const query = String(rawQuery ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
  const scored = allFiles
    .map((filePath) => ({
      filePath,
      score: fuzzyScore(query, filePath)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.filePath);

  return scored;
}

function countLines(text) {
  if (!text) {
    return 0;
  }
  return String(text).split(/\r?\n/).length;
}

export async function loadMentionedFileContexts({
  repoRoot,
  mentions,
  extraPaths = [],
  maxFileLines = 500,
  maxTotalLines = 1500
}) {
  const uniquePaths = [...new Set([...(mentions ?? []), ...(extraPaths ?? [])])];
  const contexts = [];
  const warnings = [];
  let usedTotalLines = 0;

  for (const rawPath of uniquePaths) {
    const resolvedPath = resolveMentionPath(repoRoot, rawPath);
    if (!resolvedPath) {
      warnings.push(`Skipped "${rawPath}" (path is invalid or outside repository root).`);
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(resolvedPath);
    } catch {
      warnings.push(`Could not load "${rawPath}" (file does not exist).`);
      continue;
    }

    if (!fileStat.isFile()) {
      warnings.push(`Skipped "${rawPath}" (not a file).`);
      continue;
    }

    const content = await readFile(resolvedPath, "utf8");
    const lineCount = countLines(content);
    if (lineCount > maxFileLines) {
      warnings.push(`Skipped "${rawPath}" (${lineCount} lines exceeds max ${maxFileLines}).`);
      continue;
    }

    if (usedTotalLines + lineCount > maxTotalLines) {
      warnings.push(`Skipped "${rawPath}" (total context line budget exceeded: ${maxTotalLines}).`);
      continue;
    }

    usedTotalLines += lineCount;
    contexts.push({
      path: path.relative(repoRoot, resolvedPath).replaceAll("\\", "/"),
      content,
      lineCount
    });
  }

  return { contexts, warnings };
}
