import { exampleHeader } from "../validate/message.js";

/**
 * Machine-readable summary of the commit rules, for agents and tooling.
 * @param {object} config
 */
export function describeRules(config) {
  return {
    format: config.format,
    types: config.types,
    scope: {
      used: config.askScope,
      allowed: config.askScope ? (config.scopes ?? []) : [],
      strict: Boolean(config.strictScopes)
    },
    ticket: {
      used: config.askTicket,
      prefix: config.askTicket ? (config.ticketPrefix ?? "") : ""
    },
    breaking: { used: config.askBreaking, marker: "!" },
    headerMaxLength: config.headerMaxLength ?? null,
    example: exampleHeader(config),
    commands: {
      commit: commitCommandExample(config),
      validate: 'gitsmith check "<header>"',
      dryRun: `${commitCommandExample(config)} --dry-run --json`
    }
  };
}

function commitCommandExample(config) {
  const parts = [`gitsmith -t ${config.types[0]}`];
  if (config.askScope) {
    parts.push(`-s ${config.scopes?.[0] ?? "<scope>"}`);
  }
  if (config.askTicket) {
    parts.push("--ticket 123");
  }
  parts.push('-m "<imperative summary>"');
  return parts.join(" ");
}

/**
 * Markdown block describing the rules, for AGENTS.md / CLAUDE.md and `gitsmith rules`.
 * @param {object} config
 */
export function renderRulesMarkdown(config) {
  const rules = describeRules(config);
  const lines = [
    "## Commit messages",
    "",
    "This repo uses [gitsmith](https://www.npmjs.com/package/gitsmith). Every commit header must follow:",
    "",
    "```",
    rules.format,
    "```",
    "",
    `- **type** (required): ${rules.types.map((t) => `\`${t}\``).join(", ")}`
  ];

  if (rules.scope.used) {
    const list = rules.scope.allowed.length > 0 ? rules.scope.allowed.map((s) => `\`${s}\``).join(", ") : "any single word";
    lines.push(`- **scope**${rules.scope.strict ? " (required, must be from the list)" : ""}: ${list}`);
  }
  if (rules.ticket.used) {
    lines.push(`- **ticket**: ${rules.ticket.prefix ? `starts with \`${rules.ticket.prefix}\`` : "optional"}`);
  }
  if (rules.breaking.used) {
    lines.push("- **breaking change**: pass `--breaking` (adds `!`)");
  }
  lines.push("- **message**: imperative mood, lowercase, no trailing period");
  if (rules.headerMaxLength) {
    lines.push(`- **header length**: at most ${rules.headerMaxLength} characters`);
  }

  lines.push(
    "",
    `Example: \`${rules.example}\``,
    "",
    "Commit without prompts (works for AI agents and scripts):",
    "",
    "```bash",
    rules.commands.commit,
    "```",
    "",
    "Add `--body \"...\"` for a body, `--dry-run --json` to preview, and `--json` for machine-readable output.",
    'Check a message before committing with `gitsmith check "<header>"`. Run `gitsmith rules --json` for these rules as JSON.'
  );

  return lines.join("\n");
}
