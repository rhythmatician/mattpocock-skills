import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const resolvePhysicalPath = (targetPath: string) => {
  const absoluteTarget = resolve(targetPath);
  const missingSegments: string[] = [];
  let existingParent = absoluteTarget;
  while (!existsSync(existingParent)) {
    missingSegments.unshift(basename(existingParent));
    const parent = dirname(existingParent);
    if (parent === existingParent) break;
    existingParent = parent;
  }
  return resolve(realpathSync(existingParent), ...missingSegments);
};

export const isPathInsideRepository = (
  repositoryRoot: string,
  targetPath: string,
) => {
  const relativePath = relative(
    resolvePhysicalPath(repositoryRoot),
    resolvePhysicalPath(targetPath),
  );
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
};

export const writeJsonEvidence = (outputPath: string, value: unknown) => {
  const absolutePath = resolve(outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  try {
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write failure.
    }
    throw error;
  }
};
