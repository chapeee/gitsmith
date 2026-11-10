import { Command } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";
import { runAgentsCommand } from "./commands/agents.js";
import { runCheckCommand } from "./commands/check.js";
import { runAgentCommand } from "./commands/agent.js";
import { hasCommitFlags, runCommitCommand, runFlagsCommit } from "./commands/commit.js";
import { runHookInstallCommand, runHookUninstallCommand } from "./commands/hook.js";
import { runInitCommand } from "./commands/init.js";
import { runRulesCommand } from "./commands/rules.js";

const pkg = createRequire(import.meta.url)("../package.json");

const collect = (value, previous = []) => [...previous, value];

/**
 * Options shared by the agent and `commit`: commit parts for the no-prompt flow,
 * plus attribution.
 * @param {import("commander").Command} command
 */
function addCommitPartOptions(command) {
  return command
    .option("-t, --type <type>", "Commit type (no-prompt mode)")
    .option("-s, --scope <scope>", "Commit scope (no-prompt mode)")
    .option("-m, --message <message>", "Commit summary (no-prompt mode)")
    .option("--ticket <ticket>", "Ticket id; ticketPrefix is added if missing (no-prompt mode)")
    .option("-b, --breaking", "Mark as a breaking change (no-prompt mode)")
    .option("--body <body>", "Commit body (no-prompt mode)")
    .option("--co-author <person>", 'Add a Co-Authored-By trailer, "Name <email>" (repeatable)', collect)
    .option("--author <person>", 'Set the commit author, "Name <email>"; you stay the committer')
    .option("--dry-run", "Validate and show the header without committing")
    .option("--json", "Print the result as JSON (no-prompt mode)");
}
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
    .description("GitSmith: the commit agent that follows your team's commit rules")
    .version(pkg.version);

  program
    .command("init")
    .description("Create a default .commitconfig.json in the current directory")
    .option("-f, --force", "Overwrite existing config file")
    .action(async (options) => {
      await runInitCommand(options);
    });

  // `gitsmith` with no subcommand is the agent. Commit-part flags still switch to
  // the no-prompt flow, and --no-ai to the guided prompts, so nothing that worked breaks.
  const agent = program
    .command("agent", { isDefault: true })
    .description("Default. The agent reads your staged changes, writes the commit and commits after you approve")
    .option("-a, --all", "Stage all changes first when nothing is staged")
    .option("-y, --yes", "Commit without asking (for scripts and scheduled jobs)")
    .option("--hint <text>", "Tell the agent what the change is for")
    .option("--ai", "Kept for compatibility; the agent already uses AI")
    .option("--no-ai", "Skip the agent and use the guided prompts");
  addCommitPartOptions(agent).action(async (options) => {
    if (hasCommitFlags(options) || options.json || options.dryRun) {
      await runFlagsCommit(options);
    } else if (options.ai === false) {
      await runCommitCommand({ ...options, aiMode: "off" });
    } else {
      await runAgentCommand(options);
    }
  });

  const commit = program
    .command("commit")
    .description("Guided prompts: pick type, scope and message step by step (optional AI help)")
    .option("--ai", "Ask for AI help in the guided prompts")
    .option("--no-ai", "Skip the AI question");
  addCommitPartOptions(commit).action(async (options) => {
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
  gitsmith                                          (the agent: reads your changes, writes and commits)
  gitsmith --all                                    (agent; stage everything first)
  gitsmith --hint "fix login redirect"              (agent; tell it the intent)
  gitsmith --yes --all                              (agent; commit without asking, for scheduled jobs)
  gitsmith commit                                   (guided prompts, step by step)
  gitsmith --no-ai                                  (guided prompts, no AI)
  gitsmith -t feat -s api -m "add retry logic"      (no prompts, for scripts and AI agents)
  gitsmith -t fix -s ui -m "handle empty input" --co-author "Claude <noreply@anthropic.com>"
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
