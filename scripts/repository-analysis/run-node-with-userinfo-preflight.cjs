const os = require("node:os");
const { spawnSync } = require("node:child_process");

const formatUserInfoError = (error) => {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    "Unable to start the repository-analysis runner because os.userInfo() failed.",
    "tsx requires the operating system to provide a username and home directory on Windows.",
    `Node ${process.version} on ${process.platform}: ${detail}`,
  ].join("\n");
};

// tsx calls os.userInfo().username when process.geteuid is unavailable, as it
// is on Windows. Run the same lookup first so failures identify the OS account
// requirement instead of surfacing from tsx's bundled startup code.
const runWithUserInfoPreflight = ({
  args = process.argv.slice(2),
  getUserInfo = os.userInfo,
  runNode = spawnSync,
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) => {
  try {
    getUserInfo();
  } catch (error) {
    writeError(formatUserInfoError(error));
    return 1;
  }

  if (args.length === 0) {
    writeError("The repository-analysis runner requires a Node entry point.");
    return 1;
  }

  const result = runNode(process.execPath, args, { stdio: "inherit" });
  if (result.error !== undefined) {
    writeError(`Unable to start Node: ${result.error.message}`);
    return 1;
  }

  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return 1;
  }

  return result.status ?? 1;
};

if (require.main === module) {
  process.exitCode = runWithUserInfoPreflight();
}

module.exports = { formatUserInfoError, runWithUserInfoPreflight };
