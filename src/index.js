import { Command } from "commander";
import pc from "picocolors";
import { runCommitCommand } from "./commands/commit.js";
import { runInitCommand } from "./commands/init.js";

export function runCli() {
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
    .action(async () => {
      await runCommitCommand();
    });

  program.configureOutput({
    outputError: (str, write) => write(pc.red(str))
  });

  program.parseAsync(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  });
}
