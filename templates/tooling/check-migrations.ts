import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function checkMigrations(root: string): Promise<void> {
  const directory = resolve(root, "packages", "database", "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error("No database migrations found");
  const prefixes = new Set<string>();
  for (const file of files) {
    if (!/^\d{4}_[a-z0-9-]+\.sql$/u.test(file))
      throw new Error(`Invalid numbered migration filename: ${file}`);
    const prefix = file.split("_")[0];
    if (!prefix || prefixes.has(prefix)) throw new Error(`Duplicate migration prefix: ${file}`);
    prefixes.add(prefix);
    const source = (await readFile(resolve(directory, file), "utf8")).trim();
    if (/^BEGIN;|COMMIT;$/imu.test(source))
      throw new Error(`Migration transaction belongs to the database runner: ${file}`);
    if (/\bDROP\s+(?:DATABASE|SCHEMA)\b/iu.test(source)) {
      throw new Error(`Migration contains a destructive database operation: ${file}`);
    }
  }
  const runner = await readFile(resolve(root, "packages", "database", "src", "migrate.ts"), "utf8");
  for (const required of ["thaarei_migrations", 'createHash("sha256")', ".begin("]) {
    if (!runner.includes(required)) throw new Error(`Migration runner is missing ${required}`);
  }
}

await checkMigrations(process.cwd());
