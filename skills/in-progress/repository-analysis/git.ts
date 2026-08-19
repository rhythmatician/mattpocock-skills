import { runCommand, type CommandRequest, type CommandResult } from "./runner.js";

export interface GitMetadata {
  readonly dirtyWorktree: boolean | null;
  readonly repositoryCommit: string | null;
}

export type CommandExecutor = (
  request: CommandRequest,
) => Promise<CommandResult>;

export async function readGitMetadata(
  repositoryRoot: string,
  execute: CommandExecutor = runCommand,
): Promise<GitMetadata> {
  const [commit, worktree] = await Promise.all([
    execute({
      arguments: ["rev-parse", "HEAD"],
      command: "git",
      cwd: repositoryRoot,
    }),
    execute({
      arguments: ["status", "--porcelain"],
      command: "git",
      cwd: repositoryRoot,
    }),
  ]);

  return {
    dirtyWorktree: worktree.kind === "success" ? worktree.stdout.trim().length > 0 : null,
    repositoryCommit: commit.kind === "success" ? commit.stdout.trim() : null,
  };
}