import { relative, resolve } from "node:path";
import { checkBoundaries } from "./boundaries.js";
import {
  checkImplementation,
  createWorkItem,
  listWorkItems,
  type NewWorkItemInput,
  syncImplementation,
  type WorkStatus,
} from "./implementation.js";
import { checkSourceOfTruth } from "./source-of-truth.js";
import type { CheckResult } from "./types.js";

interface ParsedArguments {
  readonly command: string;
  readonly flags: ReadonlyMap<string, string>;
}

const parseArguments = (argv: readonly string[]): ParsedArguments => {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === undefined) continue;
    if (!argument.startsWith("--")) continue;
    const name = argument.slice(2);
    const value = rest[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      flags.set(name, value);
      index += 1;
    } else flags.set(name, "true");
  }
  return { command, flags };
};

const required = (flags: ReadonlyMap<string, string>, name: string): string => {
  const value = flags.get(name);
  if (value === undefined || value.trim().length === 0)
    throw new Error(`Missing required option --${name}.`);
  return value;
};

const resultFor = (result: CheckResult, root: string): number => {
  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.file === undefined ? "" : relative(root, diagnostic.file);
    const line = diagnostic.line === undefined ? "" : `:${diagnostic.line}`;
    process.stderr.write(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}${line} ${diagnostic.message}\n`,
    );
  }
  return result.ok ? 0 : 1;
};

const parseStatus = (value: string | undefined): WorkStatus | undefined => {
  if (value === undefined) return undefined;
  if (value === "planned" || value === "in_progress" || value === "blocked" || value === "complete")
    return value;
  throw new Error(`Invalid --status: ${value}.`);
};

export const runCli = async (argv: readonly string[], cwd = process.cwd()): Promise<number> => {
  const parsed = parseArguments(argv);
  const root = resolve(cwd, parsed.flags.get("root") ?? ".");
  switch (parsed.command) {
    case "check:source-of-truth":
      return resultFor(await checkSourceOfTruth(root), root);
    case "check:boundaries":
      return resultFor(await checkBoundaries(root), root);
    case "implementation:list": {
      const status = parseStatus(parsed.flags.get("status"));
      const items = await listWorkItems(root);
      for (const item of items.filter(
        (candidate) => status === undefined || candidate.status === status,
      )) {
        process.stdout.write(`${item.workId}\t${item.status}\t${item.title}\n`);
      }
      return 0;
    }
    case "implementation:new": {
      const origin = parsed.flags.get("origin");
      const status = parseStatus(parsed.flags.get("status"));
      const input: NewWorkItemInput = {
        workId: required(parsed.flags, "work-id"),
        title: required(parsed.flags, "title"),
        owner: required(parsed.flags, "owner"),
        ...(origin === undefined ? {} : { origin }),
        ...(status === undefined ? {} : { status }),
        sourceOfTruthIds: splitOption(parsed.flags.get("source-of-truth-ids")),
        affectedPaths: splitOption(parsed.flags.get("affected-paths")),
      };
      const path = await createWorkItem(root, input);
      process.stdout.write(`${relative(root, path)}\n`);
      return 0;
    }
    case "implementation:sync":
      await syncImplementation(root);
      return 0;
    case "check:implementation":
    case "implementation:check":
      return resultFor(await checkImplementation(root), root);
    default:
      throw new Error(`Unknown governance command: ${parsed.command}.`);
  }
};

const splitOption = (value: string | undefined): readonly string[] =>
  value === undefined || value.trim() === ""
    ? []
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

const main = async (): Promise<void> => {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Governance command failed."}\n`,
    );
    process.exitCode = 1;
  }
};

if (process.argv[1]?.endsWith("/cli.ts") || process.argv[1]?.endsWith("/cli.js")) void main();
