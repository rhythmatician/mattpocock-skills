import { runCommand, type CommandResult } from "./runner.js";

export interface ToolProbe {
  readonly command: string;
  readonly cwd?: string;
  readonly versionArguments?: readonly string[];
}

export interface ToolAvailability {
  readonly available: boolean;
  readonly result: CommandResult;
  readonly version: string | null;
}

export async function probeTool(probe: ToolProbe): Promise<ToolAvailability> {
  const result = await runCommand({
    arguments: probe.versionArguments ?? ["--version"],
    command: probe.command,
    cwd: probe.cwd,
  });
  return {
    available: result.kind === "success",
    result,
    version: result.kind === "success" ? result.stdout.trim() : null,
  };
}