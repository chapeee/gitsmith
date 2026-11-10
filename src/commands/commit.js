import pc from "picocolors";
import {
  AiNetworkError,
  AiResponseError,
  AiValidationError,
  suggestCommit
} from "../ai/nvidia.js";
import { loadValidatedConfig } from "../config/loader.js";
import { askConfirm, askText, collectCommitData } from "../prompt/builder.js";
import { createCommit, ensureInsideGitRepo, ensureStagedFiles, getStagedFiles } from "../git/executor.js";
import { buildAndValidate, exampleHeader } from "../validate/message.js";
import { describeRules } from "../agent/rules.js";
import { CredentialsReadError } from "../ai/credentials.js";
import { resolveApiKeyWithoutPrompt } from "./key.js";

function mapAiErrorToMessage(error) {
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
  const frames = ["|", "/", "-", "\\"];
  let frameIndex = 0;
  process.stdout.write("Generating AI suggestion ");
  const spinnerId = setInterval(() => {
    process.stdout.write(`\rGenerating AI suggestion ${frames[frameIndex % frames.length]}`);
    frameIndex += 1;
  }, 90);
  try {
    suggestion = await suggestCommit({ description, config, apiKey: resolvedKey });
  } catch (error) {
    clearInterval(spinnerId);
    process.stdout.write("\r");
    console.log(" ");
    console.log(mapAiErrorToMessage(error));
    return { mode: "manual", initialValues: { message: description } };
  }
  clearInterval(spinnerId);
  process.stdout.write("\r");
  console.log("AI suggestion ready.           ");

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

  const { header: commitMessage, warnings } = buildAndValidate(
    {
      type: suggestion.type,
      scope: suggestion.scope ?? "",
      ticket: suggestion.ticket ?? "",
      message: suggestion.message,
      breaking: suggestion.isBreaking
    },
    config
  );

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

const COMMIT_FLAG_KEYS = ["type", "scope", "ticket", "message", "breaking", "body"];

/**
 * True when any commit part was passed as a flag, which switches to the no-prompt flow.
 * @param {object} options
 */
export function hasCommitFlags(options = {}) {
  return COMMIT_FLAG_KEYS.some((key) => options[key] !== undefined && options[key] !== false);
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY);
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
async function runFlagsCommit(options) {
  const json = Boolean(options.json);
  const log = (text) => {
    if (!json) console.log(text);
  };

  const fail = (errors, extra = {}) => {
    if (json) {
      printJson({ ok: false, errors, ...extra });
    } else {
      for (const error of errors) {
        console.error(pc.red(`Error: ${error}`));
      }
      if (extra.usage) {
        console.error(pc.cyan(`Usage: ${extra.usage}`));
        console.error(pc.cyan(`Example header: ${extra.example}`));
        console.error(pc.cyan('Run "gitsmith rules" to see every allowed value.'));
      }
    }
    process.exitCode = 1;
  };

  let config;
  try {
    await ensureInsideGitRepo();
    ({ config } = await loadValidatedConfig());
  } catch (error) {
    fail([error instanceof Error ? error.message : String(error)]);
    return;
  }

  const result = buildAndValidate(options, config);
  if (!result.ok) {
    fail(result.errors, {
      header: result.header,
      example: exampleHeader(config),
      usage: describeRules(config).commands.commit
    });
    return;
  }

  let files;
  try {
    // A dry run only previews the header, so it works before anything is staged.
    if (!options.dryRun) {
      await ensureStagedFiles();
    }
    files = await getStagedFiles();
  } catch (error) {
    fail([error instanceof Error ? error.message : String(error)], { header: result.header });
    return;
  }

  for (const warning of result.warnings) {
    log(pc.yellow(`Warning: ${warning}`));
  }

  if (options.dryRun) {
    if (json) {
      printJson({ ok: true, dryRun: true, header: result.header, body: options.body ?? "", files, warnings: result.warnings });
    } else {
      log(`${pc.cyan("Dry run, nothing committed:")} ${pc.bold(result.header)}`);
    }
    return;
  }

  let commit;
  try {
    commit = await createCommit(result.header, { body: options.body });
  } catch (error) {
    // Hooks or git itself rejected the commit; surface git's own output.
    const e = /** @type {{stderr?: string, stdout?: string, message?: string}} */ (error);
    const detail = (e.stderr || e.stdout || e.message || "git commit failed").trim();
    fail([detail], { header: result.header });
    return;
  }

  if (json) {
    printJson({ ok: true, hash: commit.hash, header: result.header, body: options.body ?? "", files, warnings: result.warnings });
  } else {
    const hashText = commit.hash ? ` ${pc.cyan(commit.hash)}` : "";
    log(pc.green(`Committed:${hashText} ${result.header}`));
  }
}

/**
 * Runs the end-to-end commit workflow:
 * validate environment, collect answers, create commit, and print next-step guidance.
 */
export async function runCommitCommand(commandOptions = {}) {
  if (hasCommitFlags(commandOptions) || commandOptions.json || commandOptions.dryRun) {
    return runFlagsCommit(commandOptions);
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
    const result = await createCommit(commitMessage);
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
