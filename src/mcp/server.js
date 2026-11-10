import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describeRules, renderRulesMarkdown } from "../agent/rules.js";
import { toShareableRules } from "../commands/rules.js";
import { loadValidatedConfig } from "../config/loader.js";
import { performCommit } from "../core/commit.js";
import { ensureInsideGitRepo, getDiffForPaths, getRepoStatus } from "../git/executor.js";
import { checkCommitMessage, exampleHeader } from "../validate/message.js";

const pkg = createRequire(import.meta.url)("../../package.json");

// Sent to the client at connect time; agents read it before choosing tools.
export const SERVER_INSTRUCTIONS = `gitsmith enforces this repository's commit rules (.commitconfig.json). Use it for every commit instead of plain git commit.

Workflow:
1. get_rules once: allowed types and scopes, format, message style.
2. get_status: what is staged, unstaged and untracked, plus recent commit subjects.
3. get_diff when you need the actual changes (skip it for changes you just wrote yourself).
4. commit with type, scope and message. You write the message: you know what the change does and why. Pass "files" to commit only some paths; call commit several times to split unrelated changes into separate commits.
5. If commit returns ok: false, read "errors", fix exactly what they say, and call commit again.

Credit yourself with co_authors, e.g. ["Claude <noreply@anthropic.com>"], when the project asks for it. Never bypass a rejected commit with git commit --no-verify.`;

/**
 * Wraps a result as MCP tool output: JSON text for any client, plus
 * structuredContent for clients that read it. Failures set isError so the agent
 * knows to fix and retry.
 */
function toolResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

async function guarded(run) {
  try {
    return await run();
  } catch (error) {
    return toolResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] }, true);
  }
}

/**
 * Builds the gitsmith MCP server. Tools run in the server's working directory,
 * which MCP clients set to the project they launch it for.
 */
export function createGitsmithServer() {
  const server = new McpServer({ name: "gitsmith", version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "get_rules",
    {
      title: "Get commit rules",
      description:
        "Returns this repository's commit rules: format, allowed types and scopes (and whether scopes are strict), ticket and breaking-change settings, message style, header length, an example header, and where each rule came from when the config extends shared rules.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    },
    async () =>
      guarded(async () => {
        const { config, chain, sources } = await loadValidatedConfig();
        const rules = describeRules(config);
        return toolResult({ ok: true, ...rules, resolvedFrom: chain, sources, summary: renderRulesMarkdown(config), shareable: toShareableRules(config) });
      })
  );

  server.registerTool(
    "get_status",
    {
      title: "Get repository status",
      description:
        "Lists staged, unstaged and untracked files (paths relative to the repo root, with git status letters), the current branch, and the last 5 commit subjects.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    },
    async () =>
      guarded(async () => {
        await ensureInsideGitRepo();
        return toolResult({ ok: true, ...(await getRepoStatus()) });
      })
  );

  server.registerTool(
    "get_diff",
    {
      title: "Get diff",
      description:
        "Returns a diff summary and the diff text: the staged changes by default, or the changes in the given paths (staged or not, compared with the last commit). Untracked files have no diff; read them directly. Long diffs are cut at max_chars.",
      inputSchema: {
        paths: z.array(z.string()).optional().describe("Only these paths, relative to the repo root"),
        max_chars: z.number().int().min(1000).max(200000).optional().describe("Cut the diff after this many characters (default 12000)")
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ paths, max_chars }) =>
      guarded(async () => {
        await ensureInsideGitRepo();
        return toolResult({ ok: true, ...(await getDiffForPaths({ paths, maxChars: max_chars })) });
      })
  );

  server.registerTool(
    "check_message",
    {
      title: "Check a commit message",
      description:
        "Validates a full commit message (header and optional body) against the rules without committing. Returns ok, errors to fix, warnings, and the parsed parts.",
      inputSchema: {
        message: z.string().describe('The commit message, e.g. "feat(api): add retry logic"')
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
    },
    async ({ message }) =>
      guarded(async () => {
        const { config } = await loadValidatedConfig();
        const result = checkCommitMessage(message, config);
        return toolResult({ ...result, example: exampleHeader(config) }, !result.ok);
      })
  );

  server.registerTool(
    "commit",
    {
      title: "Commit",
      description:
        "Builds the header from the parts using the repo's format, validates it against the rules, and runs git commit. With files, commits exactly those paths (new files included) and leaves anything else staged, so you can split work into several commits; without files, commits what is staged. On ok: false nothing is committed: fix the listed errors and call again. dry_run validates without committing.",
      inputSchema: {
        type: z.string().describe("Commit type; must be one of the allowed types"),
        scope: z.string().optional().describe("Scope; required when the rules list scopes"),
        message: z.string().describe("Summary in imperative mood, e.g. \"add retry logic\""),
        body: z.string().optional().describe("Optional body: what changed and why"),
        breaking: z.boolean().optional().describe("Marks a breaking change (adds ! when the format supports it)"),
        ticket: z.string().optional().describe("Ticket id, when the rules use tickets"),
        files: z.array(z.string()).optional().describe("Commit only these paths, relative to the repo root"),
        co_authors: z.array(z.string()).optional().describe('Co-Authored-By trailers, each "Name <email>"'),
        author: z.string().optional().describe('Commit author "Name <email>"; the configured git user stays committer'),
        dry_run: z.boolean().optional().describe("Validate and return the header without committing")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async (args) =>
      guarded(async () => {
        const result = await performCommit({
          type: args.type,
          scope: args.scope,
          message: args.message,
          body: args.body,
          breaking: args.breaking,
          ticket: args.ticket,
          files: args.files,
          coAuthors: args.co_authors,
          author: args.author,
          dryRun: args.dry_run
        });
        return toolResult(result, !result.ok);
      })
  );

  return server;
}

/**
 * `gitsmith mcp`: serves the tools over stdio. stdout carries the protocol, so
 * nothing else may print there.
 */
export async function runMcpServer() {
  const server = createGitsmithServer();
  await server.connect(new StdioServerTransport());
}
