import { Command } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";
import { runAgentsCommand } from "./commands/agents.js";
import { runCheckCommand } from "./commands/check.js";
import { runCommitCommand } from "./commands/commit.js";
import { runHookInstallCommand, runHookUninstallCommand } from "./commands/hook.js";
import { runInitCommand } from "./commands/init.js";
import { runRulesCommand } from "./commands/rules.js";

const pkg = createRequire(import.meta.url)("../package.json");
import {
  runKeyRemoveCommand,
  runKeySetCommand,
  runKeyShowCommand,
  runKeyStatusCommand
} from "./commands/key.js";

/**
 * Bootstraps the CLI program and registers all public commands.
 */
export function runCli() {
  // Single commander instance for global options and command routing.
  const program = new Command();

  program
    .name("gitsmith")
    .description("GitSmith: configurable conventional commits CLI")
    .version(pkg.version);

  program
    .command("init")
    .description("Create a default .commitconfig.json in the current directory")
    .option("-f, --force", "Overwrite existing config file")
    .action(async (options) => {
      await runInitCommand(options);
    });

  program
    .command("commit", { isDefault: true })
    .description("Create commit message from project config and run git commit")
    .option("--ai", "Force AI prompt for this run")
    .option("--no-ai", "Skip AI prompt for this run")
    .option("-t, --type <type>", "Commit type (no-prompt mode)")
    .option("-s, --scope <scope>", "Commit scope (no-prompt mode)")
    .option("-m, --message <message>", "Commit summary (no-prompt mode)")
    .option("--ticket <ticket>", "Ticket id; ticketPrefix is added if missing (no-prompt mode)")
    .option("-b, --breaking", "Mark as a breaking change (no-prompt mode)")
    .option("--body <body>", "Commit body (no-prompt mode)")
    .option("--dry-run", "Validate and show the header without committing")
    .option("--json", "Print the result as JSON (no-prompt mode)")
    .action(async (options) => {
      const aiMode = options.ai === false ? "off" : options.ai === true ? "force" : "auto";
      await runCommitCommand({ ...options, aiMode });
    });

  program
    .command("check [message]")
    .description("Check a commit message against .commitconfig.json without committing")
    .option("--file <path>", "Read the message from a file (used by the commit-msg hook)")
    .option("--stdin", "Read the message from stdin")
    .option("--json", "Print the result as JSON")
    .action(async (message, options) => {
      await runCheckCommand(message, options);
    });

  program
    .command("rules")
    .description("Print the commit rules for this repo (for people and AI agents)")
    .option("--json", "Print the rules as JSON")
    .action(async (options) => {
      await runRulesCommand(options);
    });

  const hook = program.command("hook").description("Manage the commit-msg git hook");
  hook
    .command("install")
    .description("Check every commit message, including plain git commit, against the config")
    .option("-f, --force", "Replace an existing commit-msg hook")
    .action(async (options) => {
      await runHookInstallCommand(options);
    });
  hook
    .command("uninstall")
    .description("Remove the gitsmith commit-msg hook")
    .action(async () => {
      await runHookUninstallCommand();
    });

  program
    .command("agents")
    .description("Write the commit rules into AGENTS.md (or other agent instruction files)")
    .option("--file <path...>", "Target file(s), e.g. AGENTS.md CLAUDE.md .cursorrules")
    .action(async (options) => {
      await runAgentsCommand(options);
    });

  program
    .command("key:set [key]")
    .description("Save or overwrite NVIDIA API key")
    .action(async (key) => {
      await runKeySetCommand(key);
    });

  program
    .command("key:show")
    .description("Show saved key in masked form")
    .action(async () => {
      await runKeyShowCommand();
    });

  program
    .command("key:remove")
    .description("Remove saved NVIDIA API key")
    .action(async () => {
      await runKeyRemoveCommand();
    });

  program
    .command("key:reset")
    .description("Alias for key:remove")
    .action(async () => {
      await runKeyRemoveCommand();
    });

  program
    .command("key:status")
    .description("Show saved key status")
    .action(async () => {
      await runKeyStatusCommand();
    });

  program.configureOutput({
    // Keep all commander error output consistently colored.
    outputError: (str, write) => write(pc.red(str))
  });

  program.addHelpText(
    "after",
    `
Examples:
  gitsmith
  gitsmith --ai
  gitsmith --no-ai
  gitsmith -t feat -s api -m "add retry logic"      (no prompts, for scripts and AI agents)
  gitsmith -t fix -m "handle empty input" --dry-run --json
  gitsmith check "feat(api): add retry logic"
  gitsmith rules --json
  gitsmith hook install
  gitsmith agents --file AGENTS.md CLAUDE.md
  gitsmith init --force
  gitsmith key:set
  gitsmith key:show
  gitsmith key:status
  gitsmith key:remove
  gitsmith key:reset
`
  );

  program.parseAsync(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  });
}
