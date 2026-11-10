import pc from "picocolors";
import {
  AiNetworkError,
  AiResponseError,
  AiValidationError,
  suggestCommit
} from "../ai/nvidia.js";
import { loadValidatedConfig } from "../config/loader.js";
import { askConfirm, askText, collectCommitData } from "../prompt/builder.js";
import {
  createCommit,
  ensureInsideGitRepo,
  ensureStagedFiles,
  isValidPerson
} from "../git/executor.js";
import { buildAndValidate } from "../validate/message.js";
import { CredentialsReadError } from "../ai/credentials.js";
import { resolveApiKeyWithoutPrompt } from "./key.js";
import { withSpinner } from "../ui/spinner.js";
import { performCommit } from "../core/commit.js";

export function mapAiErrorToMessage(error) {
  if (error instanceof CredentialsReadError) {
    return "Could not read ~/.gitsmith/credentials.json. Falling back to manual.";
  }
  if (error instanceof AiNetworkError && (error.status === 401 || error.status === 403)) {
    return 'NVIDIA rejected your API key. Run "gitsmith key:set" to update it. Falling back to manual.';
  }
  if (error instanceof AiNetworkError) {
    return `AI request failed (${error.message}). Falling back to manual.`;
  }
  if (error instanceof AiResponseError) {
    return "AI returned invalid response. Falling back to manual.";
  }
  if (error instanceof AiValidationError) {
    return `AI suggested an invalid ${error.field}. Falling back to manual.`;
  }
  return "AI request failed (unknown). Falling back to manual.";
}

export function shouldAskForAi(config, aiMode) {
  if (!config.ai || config.ai.enabled !== true) {
    return false;
  }
  if (aiMode === "off") {
    return false;
  }
  return aiMode === "force" || config.ai.askByDefault === true;
}

async function tryAiFlow(config, commandOptions) {
  if (!shouldAskForAi(config, commandOptions.aiMode)) {
    return null;
  }

  const wantsAi = await askConfirm("Need AI help? (y/N)", false);
  if (!wantsAi) {
    return null;
  }

  let resolvedKey;
  try {
    resolvedKey = await resolveApiKeyWithoutPrompt();
  } catch (error) {
    if (error instanceof CredentialsReadError) {
      console.log("Could not read ~/.gitsmith/credentials.json. Falling back to manual.");
      return { mode: "manual", initialValues: {} };
    }
    throw error;
  }

  if (!resolvedKey) {
    console.log('No NVIDIA API key found. Add one with "gitsmith key:set" to use AI suggestions. Falling back to manual.');
    return { mode: "manual", initialValues: {} };
  }

  const descriptionInput = await askText("What did you do?", "");
  const description = String(descriptionInput ?? "").trim();
  if (!description) {
    return { mode: "manual", initialValues: {} };
  }

  let suggestion;
  try {
    suggestion = await withSpinner("Generating AI suggestion", () =>
      suggestCommit({ description, config, apiKey: resolvedKey })
    );
  } catch (error) {
    console.log(mapAiErrorToMessage(error));
    return { mode: "manual", initialValues: { message: description } };
  }
  console.log("AI suggestion ready.");

  if (suggestion.scopeIsNew === true) {
    const acceptNewScope = await askConfirm(`New scope suggested: ${suggestion.scope}. Use it? (Y/n)`, true);
    if (!acceptNewScope) {
      return {
        mode: "manual",
        initialValues: {
          type: suggestion.type,
          scope: "",
          ticket: suggestion.ticket ?? "",
          message: suggestion.message,
          breaking: suggestion.isBreaking
        }
      };
    }
  }

  const { header: commitMessage, warnings, errors } = buildAndValidate(
    {
      type: suggestion.type,
      scope: suggestion.scope ?? "",
      ticket: suggestion.ticket ?? "",
      message: suggestion.message,
      breaking: suggestion.isBreaking
    },
    config
  );

  // The AI broke a project rule: let the user fix it in the pre-filled manual flow.
  if (errors.length > 0) {
    console.log(pc.yellow(`AI suggestion breaks the rules (${errors.join(" ")}). Falling back to manual.`));
    return {
      mode: "manual",
      initialValues: {
        type: suggestion.type,
        scope: suggestion.scope ?? "",
        ticket: suggestion.ticket ?? "",
        message: suggestion.message,
        breaking: suggestion.isBreaking
      }
    };
  }

  console.log(`\n${pc.cyan("AI Preview:")} ${pc.bold(commitMessage)}\n`);
  for (const warning of warnings) {
    console.log(pc.yellow(`Warning: ${warning}`));
  }
  const confirmed = await askConfirm("Use this commit message? (Y/n)", true);
  if (confirmed) {
    return { mode: "ai", commitMessage };
  }

  return {
    mode: "manual",
    initialValues: {
      type: suggestion.type,
      scope: suggestion.scope ?? "",
      ticket: suggestion.ticket ?? "",
      message: suggestion.message,
      breaking: suggestion.isBreaking
    }
  };
}

const COMMIT_FLAG_KEYS = ["type", "scope", "ticket", "message", "breaking", "body", "files"];

/**
 * True when any commit part was passed as a flag, which switches to the no-prompt flow.
 * @param {object} options
 */
export function hasCommitFlags(options = {}) {
  return COMMIT_FLAG_KEYS.some((key) => options[key] !== undefined && options[key] !== false);
}

export function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY);
}

/**
 * Checks --author and --co-author values have git's "Name <email>" shape.
 * @param {{author?: string, coAuthor?: string[]}} options
 * @returns {string[]}
 */
export function validatePeople(options = {}) {
  const errors = [];
  if (options.author !== undefined && !isValidPerson(options.author)) {
    errors.push(`--author must look like "Name <email@example.com>", got "${options.author}".`);
  }
  for (const person of options.coAuthor ?? []) {
    if (!isValidPerson(person)) {
      errors.push(`--co-author must look like "Name <email@example.com>", got "${person}".`);
    }
  }
  return errors;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Commit without prompts: every part comes from flags, is validated against the
 * config, and the outcome is reported as text or as JSON (--json).
 * Exits with code 1 when validation or git fails, so agents can retry.
 * @param {object} options
 */
export async function runFlagsCommit(options) {
  const result = await performCommit({
    type: options.type,
    scope: options.scope,
    message: options.message,
    ticket: options.ticket,
    breaking: options.breaking,
    body: options.body,
    coAuthors: options.coAuthor,
    author: options.author,
    files: options.files,
    dryRun: options.dryRun
  });

  if (options.json) {
    const { hint: _hint, ...output } = result;
    printJson({ ...output, author: options.author ?? null });
  } else if (result.ok) {
    for (const warning of result.warnings) console.log(pc.yellow(`Warning: ${warning}`));
    if (result.dryRun) {
      console.log(`${pc.cyan("Dry run, nothing committed:")} ${pc.bold(result.header)}`);
    } else {
      const hashText = result.hash ? ` ${pc.cyan(result.hash)}` : "";
      console.log(pc.green(`Committed:${hashText} ${result.header}`));
    }
  } else {
    for (const error of result.errors) console.error(pc.red(`Error: ${error}`));
    if (result.hint) {
      console.error(pc.cyan(`Usage: ${result.hint.usage}`));
      console.error(pc.cyan(`Example header: ${result.hint.example}`));
      console.error(pc.cyan("Run \"gitsmith rules\" to see every allowed value."));
    }
  }

  if (!result.ok) process.exitCode = 1;
}

/**
 * Runs the end-to-end commit workflow:
 * validate environment, collect answers, create commit, and print next-step guidance.
 */
export async function runCommitCommand(commandOptions = {}) {
  if (hasCommitFlags(commandOptions) || commandOptions.json || commandOptions.dryRun) {
    return runFlagsCommit(commandOptions);
  }

  const peopleErrors = validatePeople(commandOptions);
  if (peopleErrors.length > 0) {
    throw new Error(peopleErrors.join("\n"));
  }

  if (!isInteractiveTerminal()) {
    throw new Error(
      [
        "gitsmith needs an interactive terminal for prompts.",
        "Scripts and AI agents can pass the parts as flags instead:",
        '  gitsmith -t <type> -s <scope> -m "<message>"',
        'Run "gitsmith rules" to see the allowed values.'
      ].join("\n")
    );
  }

  try {
    console.log(pc.cyan("Preparing commit flow..."));

    await ensureInsideGitRepo();
    await ensureStagedFiles();
    const { config } = await loadValidatedConfig();

    console.log(pc.green("Environment checks passed."));

    const aiResult = await tryAiFlow(config, commandOptions);
    const commitMessage =
      aiResult?.mode === "ai"
        ? aiResult.commitMessage
        : await collectCommitData(config, { initialValues: aiResult?.initialValues ?? {} });

    console.log(pc.cyan("Creating commit..."));
    const result = await createCommit(commitMessage, {
      coAuthors: commandOptions.coAuthor,
      author: commandOptions.author
    });
    console.log(pc.green("Commit created."));

    // Include hash when git output exposes it (depends on git message format).
    const hashText = result.hash ? ` ${pc.cyan(result.hash)}` : "";
    console.log(pc.green(`Done. Commit successful.${hashText}`));
    console.log(pc.cyan("Next: run `git push` to publish this commit to remote."));
  } catch (error) {
    console.log(pc.yellow("Commit aborted."));
    throw error;
  }
}
