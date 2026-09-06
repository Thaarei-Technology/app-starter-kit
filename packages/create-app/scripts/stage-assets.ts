import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const assetsRoot = resolve(packageRoot, "assets");

await rm(assetsRoot, { recursive: true, force: true });
await mkdir(assetsRoot, { recursive: true });
await cp(resolve(repositoryRoot, "templates"), resolve(assetsRoot, "templates"), {
  recursive: true,
});
await cp(
  resolve(repositoryRoot, "packages/tooling/src/governance"),
  resolve(assetsRoot, "packages/tooling/src/governance"),
  { recursive: true },
);
await cp(
  resolve(repositoryRoot, "packages/tooling/tests/governance.test.ts"),
  resolve(assetsRoot, "packages/tooling/tests/governance.test.ts"),
);
