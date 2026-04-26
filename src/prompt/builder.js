import enquirer from "enquirer";
import pc from "picocolors";
import { buildCommitMessage } from "../format/template.js";

const { prompt } = enquirer;
// Reserved sentinel value used to detect custom scope selection.
const CUSTOM_SCOPE_CHOICE = "__custom_scope__";

/**
 * Normalizes prompt-cancel detection across platform-specific errors/signals.
 */
function isPromptCancelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|canceled|cancelled|sigint/i.test(message);
}

/**
 * Runs a single prompt and exits gracefully on cancellation.
 */
async function ask(question) {
  try {
    const response = await prompt(question);
    return response[question.name];
  } catch (error) {
    if (isPromptCancelError(error)) {
      console.log(pc.yellow("Commit cancelled."));
      process.exit(0);
    }
    throw error;
  }
}

export async function askConfirm(message, initial = false) {
  return ask({
    type: "confirm",
    name: "confirmed",
    message,
    initial
  });
}

export async function askText(message, initial = "", validate) {
  return ask({
    type: "input",
    name: "value",
    message,
    initial,
    validate
  });
}

/**
 * Asks manual commit questions. Optional initialValues are used to pre-fill answers.
 * @param {object} config
 * @param {{initialValues?: {type?: string, scope?: string, ticket?: string, message?: string, breaking?: boolean}}} options
 */
export async function collectCommitData(config, options = {}) {
  const initial = options.initialValues ?? {};

  // Required: commit type always comes from the configured type list.
  const type = await ask({
    type: "select",
    name: "type",
    message: "Select commit type",
    choices: config.types,
    initial: config.types.includes(initial.type) ? initial.type : undefined
  });

  let scope = "";
  if (config.askScope) {
    if (Array.isArray(config.scopes) && config.scopes.length > 0) {
      const initialScopeInList = config.scopes.includes(initial.scope);
      const initialSelectValue = initialScopeInList ? initial.scope : CUSTOM_SCOPE_CHOICE;
      // Teams can define fixed scopes, while still allowing ad-hoc "Other".
      const selectedScope = await ask({
        type: "select",
        name: "scope",
        message: "Select scope",
        choices: [
          ...config.scopes,
          { name: CUSTOM_SCOPE_CHOICE, message: "Other (type custom scope)" }
        ],
        initial: initial.scope ? initialSelectValue : undefined
      });

      if (selectedScope === CUSTOM_SCOPE_CHOICE) {
        const customScopeInput = await ask({
          type: "input",
          name: "customScope",
          message: "Enter custom scope",
          initial: initialScopeInList ? "" : String(initial.scope ?? ""),
          validate: (value) =>
            String(value).trim().length > 0 ? true : "Custom scope cannot be empty"
        });
        scope = String(customScopeInput).trim();
      } else {
        scope = selectedScope;
      }
    } else {
      const scopeInput = await ask({
        type: "input",
        name: "scope",
        message: "Enter scope (optional)",
        initial: String(initial.scope ?? "")
      });
      scope = String(scopeInput ?? "").trim();
    }
  }

  let ticket = "";
  if (config.askTicket) {
    // Prefix is configured once and auto-prepended to entered ticket number.
    const prefix = config.ticketPrefix ?? "";
    const ticketInput = await ask({
      type: "input",
      name: "ticket",
      message: prefix ? `Ticket number (${prefix}*)` : "Ticket number (optional)",
      initial: String(initial.ticket ?? "")
    });
    const ticketRaw = String(ticketInput ?? "").trim();
    ticket = ticketRaw ? `${prefix}${ticketRaw}` : "";
  }

  const messageInput = await ask({
    type: "input",
    name: "message",
    message: "Commit message",
    initial: String(initial.message ?? ""),
    validate: (value) => (String(value).trim().length > 0 ? true : "Message cannot be empty")
  });
  const message = String(messageInput).trim();

  let breaking = false;
  if (config.askBreaking) {
    breaking = await ask({
      type: "confirm",
      name: "breaking",
      message: "Is this a breaking change?",
      initial: Boolean(initial.breaking ?? false)
    });
  }

  const commitMessage = buildCommitMessage(config.format, {
    type,
    scope,
    ticket,
    message,
    breaking
  });

  const headerLimit = config.headerMaxLength;
  if (headerLimit && commitMessage.length > headerLimit) {
    // Warn only; do not block commits because some teams prefer flexibility.
    console.log(
      pc.yellow(
        `Warning: commit header is ${commitMessage.length} characters (limit: ${headerLimit}).`
      )
    );
  }

  console.log(`\n${pc.cyan("Preview:")} ${pc.bold(commitMessage)}\n`);

  const confirmed = await askConfirm("Use this commit message?", true);

  if (!confirmed) {
    console.log(pc.yellow("Commit cancelled."));
    process.exit(0);
  }

  return commitMessage;
}
