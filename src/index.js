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
    .action(async () => {
      const aiMode = process.argv.includes("--no-ai")
        ? "off"
        : process.argv.includes("--ai")
          ? "force"
          : "auto";
      console.log(`[TRACE:index] commit action invoked, aiMode=${aiMode}, argv=${JSON.stringify(process.argv)}`);
      await runCommitCommand({ aiMode });
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

  program.parseAsync(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  });
}
