import pc from "picocolors";
import {
  AiNetworkError,
  AiResponseError,
  AiValidationError,
  suggestCommit
} from "../ai/nvidia.js";
import { loadValidatedConfig } from "../config/loader.js";
import { buildCommitMessage } from "../format/template.js";
import { askConfirm, askText, collectCommitData } from "../prompt/builder.js";
import { createCommit, ensureInsideGitRepo, ensureStagedFiles } from "../git/executor.js";
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

async function tryAiFlow(config, commandOptions) {
  console.log(
    `[TRACE:ai-gate] hasAi=${Boolean(config.ai)} enabled=${config.ai?.enabled} aiMode=${commandOptions.aiMode}`
  );
  if (!config.ai || config.ai.enabled !== true) {
    console.log("[TRACE:ai-gate] skip reason: ai block missing or disabled");
    return null;
  }

  if (commandOptions.aiMode === "off") {
    console.log("[TRACE:ai-gate] skip reason: --no-ai mode");
    return null;
  }

  const wantsAi =
    commandOptions.aiMode === "force" ? true : await askConfirm("Need AI help? (y/N)", false);
  console.log(`[TRACE:ai-gate] wantsAi=${wantsAi}`);
  if (!wantsAi) {
    console.log("[TRACE:ai-gate] user declined AI");
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
    console.log("[TRACE:ai-gate] no API key found from env/file");
    console.log('No NVIDIA API key found. Run "gitsmith key:set". Falling back to manual.');
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

  const commitMessage = buildCommitMessage(config.format, {
    type: suggestion.type,
    scope: suggestion.scope ?? "",
    ticket: suggestion.ticket ?? "",
    message: suggestion.message,
    breaking: suggestion.isBreaking
  });

  console.log(`\n${pc.cyan("AI Preview:")} ${pc.bold(commitMessage)}\n`);
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

/**
 * Runs the end-to-end commit workflow:
 * validate environment, collect answers, create commit, and print next-step guidance.
 */
export async function runCommitCommand(commandOptions = {}) {
  try {
    console.log(`[TRACE:commit] runCommitCommand options=${JSON.stringify(commandOptions)}`);
    console.log(pc.cyan("Preparing commit flow..."));

    await ensureInsideGitRepo();
    await ensureStagedFiles();
    const { config } = await loadValidatedConfig();

    console.log(pc.green("Environment checks passed."));

    const aiResult = await tryAiFlow(config, commandOptions);
    console.log(`[TRACE:commit] aiResultMode=${aiResult?.mode ?? "none"}`);
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
