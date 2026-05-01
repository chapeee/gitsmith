import { Command } from "commander";
import pc from "picocolors";
import { runCommitCommand } from "./commands/commit.js";
import { runInitCommand } from "./commands/init.js";
import {
  runKeyRemoveCommand,
  runKeySetCommand,
  runKeyShowCommand,
  runKeyStatusCommand
} from "./commands/key.js";
import {
  runModelCurrentCommand,
  runModelListCommand,
  runModelPickCommand,
  runModelSetCommand,
  runModelSwitchCommand
} from "./commands/model.js";

/**
 * Bootstraps the CLI program and registers all public commands.
 */
export function runCli() {
  // Single commander instance for global options and command routing.
  const program = new Command();

  program
    .name("gitsmith")
    .description("GitSmith: configurable conventional commits CLI")
    .version("0.1.0");

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
    .option("-m, --model <model-id>", "Use a model for this run only")
    .option(
      "-c, --context-file <path>",
      "Include file contents as AI context (repeatable)",
      (value, previous) => [...previous, value],
      []
    )
    .action(async (options) => {
      const aiMode = process.argv.includes("--no-ai")
        ? "off"
        : process.argv.includes("--ai")
          ? "force"
          : "auto";
      await runCommitCommand({
        aiMode,
        contextFiles: options.contextFile ?? [],
        model: options.model ?? null
      });
    });

  const modelCommand = program
    .command("model")
    .description("Manage default NVIDIA model")
    .action(async () => {
      await runModelPickCommand();
    });

  modelCommand
    .command("list")
    .description("Show supported models")
    .action(async () => {
      await runModelListCommand();
    });

  modelCommand
    .command("current")
    .description("Show current default model")
    .action(async () => {
      await runModelCurrentCommand();
    });

  modelCommand
    .command("set <model-id>")
    .description("Set default model non-interactively")
    .action(async (modelId) => {
      await runModelSetCommand(modelId);
    });

  modelCommand
    .command("switch")
    .description("Interactively select model and verify availability before saving")
    .action(async () => {
      await runModelSwitchCommand();
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
  gitsmith --model deepseek-ai/deepseek-v4-flash
  gitsmith --context-file src/auth/login.ts
  gitsmith --context-file src/auth/login.ts --context-file README.md
  gitsmith model
  gitsmith model list
  gitsmith model current
  gitsmith model set deepseek-ai/deepseek-v4-flash
  gitsmith model switch
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
