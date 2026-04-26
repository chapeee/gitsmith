import pc from "picocolors";
import { loadValidatedConfig } from "../config/loader.js";
import { collectCommitData } from "../prompt/builder.js";
import { createCommit, ensureInsideGitRepo, ensureStagedFiles } from "../git/executor.js";

/**
 * Runs the end-to-end commit workflow:
 * validate environment, collect answers, create commit, and print next-step guidance.
 */
export async function runCommitCommand() {
  try {
    console.log(pc.cyan("Preparing commit flow..."));

    await ensureInsideGitRepo();
    await ensureStagedFiles();
    const { config } = await loadValidatedConfig();

    console.log(pc.green("Environment checks passed."));

    const commitMessage = await collectCommitData(config);

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
