import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function hasAnyPath(
  directory: string,
  names: readonly string[],
): Promise<boolean> {
  for (const name of names) {
    try {
      await access(join(directory, name));
      return true;
    } catch {
      // Another marker may identify this repository.
    }
  }
  return false;
}

export async function hasRootFileWithExtension(
  directory: string,
  extensions: readonly string[],
): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.some(
      (entry) =>
        entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)),
    );
  } catch {
    return false;
  }
}