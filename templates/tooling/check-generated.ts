import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function snapshot(directory: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.set(relative(directory, path), await readFile(path, "utf8"));
    }
  }
  await visit(directory);
  return files;
}

export async function checkGeneratedClient(root: string): Promise<void> {
  const generatedDirectory = resolve(root, "packages", "api-client", "src", "generated");
  const before = await snapshot(generatedDirectory);
  await execFileAsync("pnpm", ["generate:api-client"], { cwd: root });
  const after = await snapshot(generatedDirectory);
  if (before.size !== after.size) throw new Error("Generated API client file set is stale");
  for (const [path, content] of before) {
    if (after.get(path) !== content) throw new Error(`Generated API client is stale: ${path}`);
  }
}

await checkGeneratedClient(process.cwd());
