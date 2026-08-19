import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function checkMigrations(root: string): Promise<void> {
  const directory = resolve(root, "packages", "database", "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error("No database migrations found");
  const prefixes = new Set<string>();
  for (const file of files) {
    const prefix = file.split("_")[0];
    if (!prefix || prefixes.has(prefix)) throw new Error(`Duplicate migration prefix: ${file}`);
    prefixes.add(prefix);
    const source = (await readFile(resolve(directory, file), "utf8")).trim();
    if (!/^BEGIN;/iu.test(source) || !/COMMIT;$/iu.test(source)) {
      throw new Error(`Migration must have an explicit transaction: ${file}`);
    }
    if (/\bDROP\s+(?:DATABASE|SCHEMA)\b/iu.test(source)) {
      throw new Error(`Migration contains a destructive database operation: ${file}`);
    }
  }
}

await checkMigrations(process.cwd());
