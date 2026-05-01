import enquirer from "enquirer";
import pc from "picocolors";
import readline from "node:readline";
import { buildCommitMessage } from "../format/template.js";
import { suggestMentionedFiles } from "../ai/file-context.js";

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

function getActiveMention(text, cursor) {
  let i = cursor - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "@" && (i === 0 || /\s/.test(text[i - 1]))) {
      let end = cursor;
      while (end < text.length && !/\s/.test(text[end])) {
        end += 1;
      }
      return {
        start: i,
        end,
        query: text.slice(i + 1, cursor)
      };
    }
    i -= 1;
  }
  return null;
}

function renderMentionPrompt({
  message,
  input,
  cursor,
  suggestions,
  selectedSuggestion,
  previousRows
}) {
  if (previousRows > 0) {
    process.stdout.write(`\u001b[${previousRows}F`);
  }
  process.stdout.write("\u001b[J");

  const suggestionLine =
    suggestions.length > 0
      ? suggestions
          .map((entry, index) => (index === selectedSuggestion ? `[${entry}]` : entry))
          .join(" | ")
      : "";

  process.stdout.write(`${message} ${input}\n`);
  if (suggestionLine) {
    process.stdout.write(`${pc.cyan("File suggestions:")} ${suggestionLine}\n`);
  }

  const rows = suggestionLine ? 2 : 1;
  if (rows > 1) {
    process.stdout.write(`\u001b[${rows - 1}F`);
  }
  process.stdout.write("\r");
  process.stdout.write(`\u001b[${message.length + 1 + cursor}C`);

  return rows;
}

/**
 * Input prompt with inline @file mention suggestions.
 * Arrow up/down: pick suggestion, Tab/Enter: insert selected suggestion.
 */
export async function askTextWithFileMentions({
  message,
  initial = "",
  validate,
  repositoryFiles = [],
  suggestionLimit = 12
}) {
  if (!process.stdin.isTTY) {
    return askText(message, initial, validate);
  }

  const files = Array.isArray(repositoryFiles) ? repositoryFiles : [];
  if (files.length === 0) {
    return askText(message, initial, validate);
  }

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin, rl);

    let input = String(initial ?? "");
    let cursor = input.length;
    let suggestions = [];
    let selectedSuggestion = 0;
    let previousRows = 0;

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const refreshSuggestions = () => {
      const active = getActiveMention(input, cursor);
      if (!active) {
        suggestions = [];
        selectedSuggestion = 0;
        return null;
      }
      suggestions = suggestMentionedFiles(files, active.query, suggestionLimit);
      if (selectedSuggestion >= suggestions.length) {
        selectedSuggestion = 0;
      }
      return active;
    };

    const applySelectedSuggestion = (activeMention) => {
      if (!activeMention || suggestions.length === 0) {
        return false;
      }
      const picked = suggestions[selectedSuggestion];
      input = `${input.slice(0, activeMention.start + 1)}${picked}${input.slice(activeMention.end)}`;
      cursor = activeMention.start + 1 + picked.length;
      return true;
    };

    const render = () => {
      const active = refreshSuggestions();
      previousRows = renderMentionPrompt({
        message,
        input,
        cursor,
        suggestions,
        selectedSuggestion,
        previousRows
      });
      return active;
    };

    const finish = () => {
      const value = String(input ?? "");
      if (typeof validate === "function") {
        const validationResult = validate(value);
        if (validationResult !== true) {
          console.log(`\n${pc.yellow(String(validationResult))}`);
          render();
          return;
        }
      }
      process.stdout.write("\n");
      cleanup();
      resolve(value);
    };

    const onKeypress = (_str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        process.stdout.write(`\n${pc.yellow("Commit cancelled.")}\n`);
        cleanup();
        process.exit(0);
      }

      const active = getActiveMention(input, cursor);

      if (key.name === "up") {
        if (suggestions.length > 0) {
          selectedSuggestion = (selectedSuggestion - 1 + suggestions.length) % suggestions.length;
        }
        render();
        return;
      }

      if (key.name === "down") {
        if (suggestions.length > 0) {
          selectedSuggestion = (selectedSuggestion + 1) % suggestions.length;
        }
        render();
        return;
      }

      if (key.name === "tab") {
        applySelectedSuggestion(active);
        render();
        return;
      }

      if (key.name === "return") {
        const usedSuggestion = applySelectedSuggestion(active);
        if (usedSuggestion) {
          render();
          return;
        }
        finish();
        return;
      }

      if (key.name === "left") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }

      if (key.name === "right") {
        cursor = Math.min(input.length, cursor + 1);
        render();
        return;
      }

      if (key.name === "backspace") {
        if (cursor > 0) {
          input = `${input.slice(0, cursor - 1)}${input.slice(cursor)}`;
          cursor -= 1;
        }
        render();
        return;
      }

      if (key.name === "delete") {
        if (cursor < input.length) {
          input = `${input.slice(0, cursor)}${input.slice(cursor + 1)}`;
        }
        render();
        return;
      }

      const char = key.sequence;
      if (char && !key.ctrl && !key.meta && char >= " ") {
        input = `${input.slice(0, cursor)}${char}${input.slice(cursor)}`;
        cursor += char.length;
        render();
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
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
