import pc from "picocolors";
import { suggestCommit } from "../ai/nvidia.js";
import { CredentialsReadError } from "../ai/credentials.js";
import { loadValidatedConfig } from "../config/loader.js";
import {
  createCommit,
  ensureInsideGitRepo,
  getChangedFiles,
  getStagedDiff,
  getStagedFiles,
  stageAll
} from "../git/executor.js";
import { askConfirm, askSelect, askText, collectCommitData } from "../prompt/builder.js";
import { withSpinner } from "../ui/spinner.js";
import { buildAndValidate } from "../validate/message.js";
import { isInteractiveTerminal, mapAiErrorToMessage, runCommitCommand, validatePeople } from "./commit.js";
import { resolveApiKeyWithoutPrompt } from "./key.js";

const MAX_ATTEMPTS = 3;
const FILE_PREVIEW_LIMIT = 10;

class AgentStop extends Error {}

/**
 * Why the agent cannot use AI, or null when it can.
 * @param {object} config
 * @param {string | null} apiKey
 */
export function aiUnavailableReason(config, apiKey) {
  if (!config.ai || config.ai.enabled !== true) {
    return 'AI is off in .commitconfig.json (set "ai": { "enabled": true } to turn it on).';
  }
  if (!apiKey) {
    return 'No NVIDIA API key found. Add one with "gitsmith key:set" or set GITSMITH_AI_KEY.';
  }
  return null;
}

function listFiles(files) {
  const shown = files.slice(0, FILE_PREVIEW_LIMIT).map((file) => `  ${file}`);
  if (files.length > FILE_PREVIEW_LIMIT) {
    shown.push(`  ...and ${files.length - FILE_PREVIEW_LIMIT} more`);
  }
  return shown.join("\n");
}

/**
 * Makes sure something is staged: offers to stage everything when nothing is,
 * or stages it straight away with --all.
 */
async function ensureSomethingStaged(options, interactive) {
  let staged = await getStagedFiles();
  if (staged.length > 0) {
    return staged;
  }

  const changed = await getChangedFiles();
  if (changed.length === 0) {
    throw new AgentStop("Nothing to commit: the working tree is clean.");
  }

  let shouldStage = Boolean(options.all);
  if (!shouldStage && interactive) {
    console.log(pc.cyan(`Nothing is staged. ${changed.length} changed file(s):`));
    console.log(listFiles(changed));
    shouldStage = await askConfirm("Stage all of them?", true);
  }
  if (!shouldStage) {
    throw new AgentStop('Nothing is staged. Stage files with "git add", or pass --all.');
  }

  await stageAll();
  staged = await getStagedFiles();
  return staged;
}

/**
 * Asks the AI for a commit, validates it against the config, and retries with
 * the rule violations as feedback when the suggestion breaks a rule.
 */
async function generateValidCommit({ config, apiKey, description, diff }) {
  let feedback = "";
  let last = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const intent = [description, feedback].filter(Boolean).join("\n\n");
    const suggestion = await withSpinner("Reading your changes and writing the commit", () =>
      suggestCommit({ description: intent, diff, config, apiKey })
    );

    const result = buildAndValidate(
      {
        type: suggestion.type,
        scope: suggestion.scope ?? "",
        ticket: suggestion.ticket ?? "",
        message: suggestion.message,
        breaking: suggestion.isBreaking
      },
      config
    );
    last = { suggestion, result };
    if (result.ok) {
      return last;
    }
    feedback = `Your previous suggestion "${result.header}" broke these rules: ${result.errors.join(" ")} Fix them.`;
  }

  return last;
}

function toInitialValues(suggestion) {
  return {
    type: suggestion.type,
    scope: suggestion.scope ?? "",
    ticket: suggestion.ticket ?? "",
    message: suggestion.message,
    breaking: suggestion.isBreaking
  };
}

/**
 * The default `gitsmith` experience: the agent reads the staged diff, writes a
 * commit that follows .commitconfig.json, and commits once you approve.
 * With --yes it commits without asking (for scripts and scheduled jobs).
 * @param {{all?: boolean, yes?: boolean, hint?: string, coAuthor?: string[], author?: string}} options
 */
export async function runAgentCommand(options = {}) {
  const interactive = isInteractiveTerminal();
  const autoApprove = Boolean(options.yes);

  if (!interactive && !autoApprove) {
    throw new Error(
      [
        "The gitsmith agent needs a terminal to ask for approval.",
        "Without one, either let it commit on its own:",
        "  gitsmith --yes [--all]",
        "or pass the commit parts yourself:",
        '  gitsmith -t <type> -s <scope> -m "<message>"'
      ].join("\n")
    );
  }

  const peopleErrors = validatePeople(options);
  if (peopleErrors.length > 0) {
    throw new Error(peopleErrors.join("\n"));
  }

  await ensureInsideGitRepo();
  const { config } = await loadValidatedConfig();

  let apiKey = null;
  try {
    apiKey = await resolveApiKeyWithoutPrompt();
  } catch (error) {
    if (!(error instanceof CredentialsReadError)) throw error;
  }

  // Without a terminal there is no fallback, so stop before touching the index.
  const unavailable = aiUnavailableReason(config, apiKey);
  if (unavailable && !interactive) {
    throw new Error(`${unavailable}\nWithout AI, pass the commit parts as flags: gitsmith -t <type> -m "<message>"`);
  }

  let staged;
  try {
    staged = await ensureSomethingStaged(options, interactive && !autoApprove);
  } catch (error) {
    if (error instanceof AgentStop) {
      console.log(pc.yellow(error.message));
      if (!interactive) process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (unavailable) {
    console.log(pc.yellow(`${unavailable} Switching to the guided prompts.`));
    await runCommitCommand({ aiMode: "off", coAuthor: options.coAuthor, author: options.author });
    return;
  }

  console.log(pc.cyan(`gitsmith agent: ${staged.length} staged file(s)`));
  console.log(listFiles(staged));

  const sendDiff = config.ai.sendDiff !== false;
  const diff = sendDiff ? await getStagedDiff() : undefined;
  let description = String(options.hint ?? "").trim();
  if (!sendDiff && !description) {
    if (!interactive) {
      throw new Error('ai.sendDiff is false, so the agent needs --hint "<what you changed>".');
    }
    description = String((await askText("What did you change?", "")) ?? "").trim();
  }

  let generated;
  while (true) {
    try {
      generated = await generateValidCommit({ config, apiKey, description, diff });
    } catch (error) {
      if (!interactive) throw new Error(mapAiErrorToMessage(error).replace(" Falling back to manual.", ""));
      console.log(pc.yellow(mapAiErrorToMessage(error)));
      await runCommitCommand({ aiMode: "off", coAuthor: options.coAuthor, author: options.author });
      return;
    }

    const { suggestion, result } = generated;
    if (!result.ok) {
      if (!interactive) {
        throw new Error(`The AI could not follow the rules after ${MAX_ATTEMPTS} tries: ${result.errors.join(" ")}`);
      }
      console.log(pc.yellow(`The AI could not follow the rules (${result.errors.join(" ")}). Finish it by hand:`));
      return commitWithPrompts(config, suggestion, options);
    }

    console.log(`\n${pc.cyan("Proposed commit:")} ${pc.bold(result.header)}`);
    if (suggestion.reason) {
      console.log(pc.dim(`Why: ${suggestion.reason}`));
    }
    for (const warning of result.warnings) {
      console.log(pc.yellow(`Warning: ${warning}`));
    }
    console.log("");

    const choice = autoApprove
      ? "commit"
      : await askSelect("What next?", [
          { name: "commit", message: "Commit" },
          { name: "edit", message: "Edit before committing" },
          { name: "regenerate", message: "Regenerate" },
          { name: "cancel", message: "Cancel" }
        ]);

    if (choice === "regenerate") {
      continue;
    }
    if (choice === "cancel") {
      console.log(pc.yellow("Commit cancelled. Your staged changes are untouched."));
      return;
    }
    if (choice === "edit") {
      return commitWithPrompts(config, suggestion, options);
    }

    return finishCommit(result.header, options);
  }
}

async function commitWithPrompts(config, suggestion, options) {
  const header = await collectCommitData(config, { initialValues: toInitialValues(suggestion) });
  return finishCommit(header, options);
}

async function finishCommit(header, options) {
  const commit = await createCommit(header, { coAuthors: options.coAuthor, author: options.author });
  const hashText = commit.hash ? ` ${pc.cyan(commit.hash)}` : "";
  console.log(pc.green(`Committed:${hashText} ${header}`));
  console.log(pc.cyan("Next: run `git push` to publish it."));
}
