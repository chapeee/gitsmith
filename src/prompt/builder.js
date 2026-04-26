import enquirer from "enquirer";
import pc from "picocolors";
import { buildCommitMessage } from "../format/template.js";

const { prompt } = enquirer;

function isPromptCancelError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|canceled|cancelled|sigint/i.test(message);
}

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

export async function collectCommitData(config) {
  const type = await ask({
    type: "select",
    name: "type",
    message: "Select commit type",
    choices: config.types
  });

  let scope = "";
  if (config.askScope) {
    if (Array.isArray(config.scopes) && config.scopes.length > 0) {
      scope = await ask({
        type: "select",
        name: "scope",
        message: "Select scope",
        choices: config.scopes
      });
    } else {
      const scopeInput = await ask({
        type: "input",
        name: "scope",
        message: "Enter scope (optional)",
        initial: ""
      });
      scope = String(scopeInput ?? "").trim();
    }
  }

  let ticket = "";
  if (config.askTicket) {
    const prefix = config.ticketPrefix ?? "";
    const ticketInput = await ask({
      type: "input",
      name: "ticket",
      message: prefix ? `Ticket number (${prefix}*)` : "Ticket number (optional)",
      initial: ""
    });
    const ticketRaw = String(ticketInput ?? "").trim();
    ticket = ticketRaw ? `${prefix}${ticketRaw}` : "";
  }

  const messageInput = await ask({
    type: "input",
    name: "message",
    message: "Commit message",
    initial: "",
    validate: (value) => (String(value).trim().length > 0 ? true : "Message cannot be empty")
  });
  const message = String(messageInput).trim();

  let breaking = false;
  if (config.askBreaking) {
    breaking = await ask({
      type: "confirm",
      name: "breaking",
      message: "Is this a breaking change?",
      initial: false
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
    console.log(
      pc.yellow(
        `Warning: commit header is ${commitMessage.length} characters (limit: ${headerLimit}).`
      )
    );
  }

  console.log(`\n${pc.cyan("Preview:")} ${pc.bold(commitMessage)}\n`);

  const confirmed = await ask({
    type: "confirm",
    name: "confirmed",
    message: "Use this commit message?",
    initial: true
  });

  if (!confirmed) {
    console.log(pc.yellow("Commit cancelled."));
    process.exit(0);
  }

  return commitMessage;
}
