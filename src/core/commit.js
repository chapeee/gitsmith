import { describeRules } from "../agent/rules.js";
import { loadValidatedConfig } from "../config/loader.js";
import {
  buildCommitBody,
  createCommit,
  ensureInsideGitRepo,
  getChangedFiles,
  getStagedFiles,
  isValidPerson
} from "../git/executor.js";
import { buildAndValidate, exampleHeader } from "../validate/message.js";

/**
 * Checks author and co-author values have git's "Name <email>" shape.
 * @param {{author?: string, coAuthors?: string[]}} input
 * @returns {string[]}
 */
export function validatePeopleInput({ author, coAuthors } = {}) {
  const errors = [];
  if (author !== undefined && author !== null && !isValidPerson(author)) {
    errors.push(`author must look like "Name <email@example.com>", got "${author}".`);
  }
  for (const person of coAuthors ?? []) {
    if (!isValidPerson(person)) {
      errors.push(`co-author must look like "Name <email@example.com>", got "${person}".`);
    }
  }
  return errors;
}

function gitErrorDetail(error) {
  const e = /** @type {{stderr?: string, stdout?: string, message?: string}} */ (error);
  return (e.stderr || e.stdout || e.message || "git commit failed").trim();
}

/**
 * Validates commit parts against the project rules and commits them. Never prints;
 * the CLI and the MCP server both build on this, so they behave identically.
 *
 * With `files`, exactly those paths are committed (new files included), and anything
 * else that is staged stays staged. That is how an agent splits one change into
 * several commits. Without `files`, whatever is staged is committed.
 *
 * @param {{
 *   type?: string, scope?: string, message?: string, ticket?: string, breaking?: boolean,
 *   body?: string, coAuthors?: string[], author?: string, files?: string[], dryRun?: boolean
 * }} input
 * @returns {Promise<{ok: boolean, errors: string[], warnings: string[], header?: string, body?: string,
 *   hash?: string | null, files?: string[], dryRun?: boolean, hint?: {usage: string, example: string}}>}
 */
export async function performCommit(input) {
  let config;
  try {
    await ensureInsideGitRepo();
    ({ config } = await loadValidatedConfig());
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
  }

  const result = buildAndValidate(input, config);
  const errors = [...result.errors, ...validatePeopleInput(input)];
  const body = buildCommitBody(input.body, input.coAuthors);
  const hint = { usage: describeRules(config).commands.commit, example: exampleHeader(config) };

  if (errors.length > 0) {
    return { ok: false, errors, warnings: result.warnings, header: result.header, hint };
  }

  const requested = (input.files ?? []).map((file) => String(file).trim()).filter(Boolean);
  let files;
  try {
    if (requested.length > 0) {
      const changed = new Set(await getChangedFiles());
      const unknown = requested.filter((file) => !changed.has(file.replace(/\\/g, "/")));
      if (unknown.length > 0) {
        return {
          ok: false,
          errors: [`These paths have no changes to commit: ${unknown.join(", ")}. Use paths relative to the repo root, as shown by get_status / git status.`],
          warnings: result.warnings,
          header: result.header
        };
      }
      files = requested;
    } else {
      files = await getStagedFiles();
      if (files.length === 0 && !input.dryRun) {
        return {
          ok: false,
          errors: ["Nothing is staged. Stage files with git add, or pass the files to commit."],
          warnings: result.warnings,
          header: result.header
        };
      }
    }
  } catch (error) {
    return { ok: false, errors: [gitErrorDetail(error)], warnings: result.warnings, header: result.header };
  }

  if (input.dryRun) {
    return { ok: true, dryRun: true, errors: [], warnings: result.warnings, header: result.header, body, files };
  }

  try {
    const commit = await createCommit(result.header, {
      body: input.body,
      coAuthors: input.coAuthors,
      author: input.author,
      paths: requested
    });
    return { ok: true, errors: [], warnings: result.warnings, header: result.header, body, hash: commit.hash, files };
  } catch (error) {
    // A hook or git itself refused the commit; pass git's own words back.
    return { ok: false, errors: [gitErrorDetail(error)], warnings: result.warnings, header: result.header };
  }
}
