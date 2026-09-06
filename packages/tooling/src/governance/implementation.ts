import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import type { CheckResult, Diagnostic } from "./types.js";

export type WorkStatus = "planned" | "in_progress" | "blocked" | "complete";

export interface WorkItem {
  readonly workId: string;
  readonly title: string;
  readonly origin?: string;
  readonly status: WorkStatus;
  readonly owner: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly sourceOfTruthIds: readonly string[];
  readonly affectedPaths: readonly string[];
  readonly body: string;
  readonly path: string;
}

export interface NewWorkItemInput {
  readonly workId: string;
  readonly title: string;
  readonly owner: string;
  readonly origin?: string;
  readonly status?: WorkStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly sourceOfTruthIds?: readonly string[];
  readonly affectedPaths?: readonly string[];
}

const VALID_STATUSES: readonly WorkStatus[] = ["planned", "in_progress", "blocked", "complete"];
const GENERATED_HEADER = "<!-- GENERATED FILE. Run `pnpm implementation:sync`. Do not edit. -->";
const REQUIRED_SECTIONS = [
  "Objective",
  "Scope",
  "Non-goals",
  "Acceptance criteria",
  "Validation",
  "Evidence",
  "Decisions",
  "Blockers",
  "Handoff",
  "Completion",
] as const;
const COMPLETED_ITEM_LIMIT = 5;

const normalizeAffectedPath = (value: string): string | undefined => {
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.includes("\\") ||
    posix.isAbsolute(candidate) ||
    /^[A-Za-z]:[\\/]/u.test(candidate)
  ) {
    return undefined;
  }
  const normalized = posix.normalize(candidate).replace(/\/+$/u, "");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    return undefined;
  return normalized;
};

const pathsOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

const scalar = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "string") throw new Error("Expected a quoted string scalar");
    return parsed;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
};

const parseList = (value: string): readonly string[] => {
  const trimmed = value.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed: unknown = JSON.parse(trimmed.replaceAll("'", '"'));
    if (Array.isArray(parsed))
      return parsed.filter((entry): entry is string => typeof entry === "string");
  }
  return trimmed
    .split(",")
    .map(scalar)
    .filter((entry) => entry.length > 0);
};

const parseFrontmatter = (
  source: string,
): { readonly values: ReadonlyMap<string, unknown>; readonly body: string } => {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return { values: new Map(), body: source };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) return { values: new Map(), body: source };
  const values = new Map<string, unknown>();
  let currentList: string | undefined;
  for (const line of lines.slice(1, closing)) {
    const listMatch = /^\s*-\s*(.*?)\s*$/u.exec(line);
    if (listMatch !== null && currentList !== undefined) {
      const prior = values.get(currentList);
      const listValue = listMatch[1];
      if (listValue !== undefined)
        values.set(currentList, [...(Array.isArray(prior) ? prior : []), scalar(listValue)]);
      continue;
    }
    const field = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/u.exec(line);
    if (field === null) continue;
    const name = field[1];
    const value = field[2];
    if (name === undefined || value === undefined) continue;
    if (value === "") {
      currentList = name;
      values.set(name, []);
    } else {
      currentList = undefined;
      values.set(
        name,
        name === "sourceOfTruthIds" || name === "affectedPaths" ? parseList(value) : scalar(value),
      );
    }
  }
  return {
    values,
    body: lines
      .slice(closing + 1)
      .join("\n")
      .replace(/^\n/u, ""),
  };
};

const isWorkStatus = (value: string): value is WorkStatus =>
  VALID_STATUSES.some((status) => status === value);

const statusFrom = (value: unknown): WorkStatus | undefined =>
  typeof value === "string" && isWorkStatus(value) ? value : undefined;

const stringFrom = (values: ReadonlyMap<string, unknown>, key: string): string | undefined => {
  const value = values.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const listFrom = (values: ReadonlyMap<string, unknown>, key: string): readonly string[] => {
  const value = values.get(key);
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

export const parseWorkItem = (source: string, path: string): WorkItem => {
  const parsed = parseFrontmatter(source);
  const workId = stringFrom(parsed.values, "workId");
  const title = stringFrom(parsed.values, "title");
  const owner = stringFrom(parsed.values, "owner");
  const status = statusFrom(parsed.values.get("status"));
  if (workId === undefined || title === undefined || owner === undefined || status === undefined) {
    throw new Error(
      `Invalid work item frontmatter in ${path}: workId, title, owner, and a valid status are required.`,
    );
  }
  const origin = stringFrom(parsed.values, "origin");
  const createdAt = stringFrom(parsed.values, "createdAt");
  const updatedAt = stringFrom(parsed.values, "updatedAt");
  return {
    workId,
    title,
    owner,
    status,
    ...(origin === undefined ? {} : { origin }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    sourceOfTruthIds: listFrom(parsed.values, "sourceOfTruthIds"),
    affectedPaths: listFrom(parsed.values, "affectedPaths"),
    body: parsed.body,
    path,
  };
};

const frontmatter = (input: NewWorkItemInput): string => {
  const status = input.status ?? "planned";
  if (!isWorkStatus(status)) throw new Error(`Unknown work status: ${status}`);
  const date = input.createdAt ?? new Date().toISOString().slice(0, 10);
  const updatedAt = input.updatedAt ?? date;
  const list = (name: string, values: readonly string[]): string =>
    values.length === 0
      ? `${name}: []`
      : `${name}:\n${values.map((value) => `  - ${value}`).join("\n")}`;
  return [
    "---",
    `workId: ${input.workId}`,
    `title: ${input.title}`,
    ...(input.origin === undefined ? [] : [`origin: ${input.origin}`]),
    `status: ${status}`,
    `owner: ${input.owner}`,
    `createdAt: ${date}`,
    `updatedAt: ${updatedAt}`,
    list("sourceOfTruthIds", input.sourceOfTruthIds ?? []),
    list("affectedPaths", input.affectedPaths ?? []),
    "---",
    "",
    `# ${input.title}`,
    "",
    "## Objective",
    "",
    "Describe the outcome this work item must achieve.",
    "",
    "## Scope",
    "",
    "List the paths and behaviors this work item may change.",
    "",
    "## Non-goals",
    "",
    "List intentionally excluded work.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] Define an observable completion condition.",
    "",
    "## Validation",
    "",
    "Record commands and their results here.",
    "",
    "## Evidence",
    "",
    "Record artifact or runtime evidence here.",
    "",
    "## Decisions",
    "",
    "Record material decisions and tradeoffs here.",
    "",
    "## Blockers",
    "",
    "None.",
    "",
    "## Handoff",
    "",
    "Record remaining work and ownership here.",
    "",
    "## Completion",
    "",
    "Incomplete.",
    "",
  ].join("\n");
};

export const listWorkItems = async (root: string): Promise<readonly WorkItem[]> => {
  const directory = resolve(root, ".thaarei", "work");
  let entries: readonly Dirent[] = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const items: WorkItem[] = [];
  for (const entry of entries.filter(
    (candidate) => candidate.isFile() && candidate.name.endsWith(".md"),
  )) {
    const path = join(directory, entry.name);
    try {
      items.push(parseWorkItem(await readFile(path, "utf8"), path));
    } catch {
      // `implementation:check` reports invalid work files; list remains useful for valid records.
    }
  }
  return items.sort((left, right) => left.workId.localeCompare(right.workId));
};

export const createWorkItem = async (root: string, input: NewWorkItemInput): Promise<string> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.workId)) {
    throw new Error(
      `Invalid work ID: ${input.workId}. Use letters, numbers, dots, underscores, and hyphens.`,
    );
  }
  const directory = resolve(root, ".thaarei", "work");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${input.workId}.md`);
  const items = await listWorkItems(root);
  if (items.some((item) => item.workId === input.workId))
    throw new Error(`Work item already exists: ${input.workId}`);
  try {
    await readFile(path, "utf8");
    throw new Error(`Work item already exists: ${input.workId}`);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === `Work item already exists: ${input.workId}`)
      throw error;
  }
  await writeFile(path, frontmatter(input), "utf8");
  return path;
};

const dashboard = (items: readonly WorkItem[]): string => {
  const lines = [
    GENERATED_HEADER,
    "",
    "# Implementation Dashboard",
    "",
    "Canonical records: `.thaarei/work/*.md`.",
    "",
  ];
  const active = items.filter((item) => item.status !== "complete");
  const completed = items
    .filter((item) => item.status === "complete")
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .slice(0, COMPLETED_ITEM_LIMIT);
  const visible = [...active, ...completed];
  if (visible.length === 0) lines.push("No work items found.", "");
  for (const item of visible) {
    lines.push(
      `## ${item.workId}: ${item.title}`,
      "",
      `- Status: ${item.status}`,
      `- Owner: ${item.owner}`,
    );
    if (item.updatedAt !== undefined) lines.push(`- Updated: ${item.updatedAt}`);
    if (item.affectedPaths.length > 0) lines.push(`- Paths: ${item.affectedPaths.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const sectionBody = (body: string, heading: string): string | undefined => {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return undefined;
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, next < 0 ? lines.length : next)
    .join("\n")
    .trim();
};

const validateWorkItem = (item: WorkItem): readonly Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (sectionBody(item.body, section) === undefined) {
      diagnostics.push({
        code: "IMPLEMENTATION_MISSING_SECTION",
        message: `Work item ${item.workId} is missing the ${section} section.`,
        file: item.path,
        severity: "error",
      });
    }
  }
  if (item.status === "complete") {
    const validation = sectionBody(item.body, "Validation") ?? "";
    const evidence = sectionBody(item.body, "Evidence") ?? "";
    const completion = sectionBody(item.body, "Completion") ?? "";
    if (validation.length === 0 || evidence.length === 0 || /\bincomplete\b/iu.test(completion)) {
      diagnostics.push({
        code: "IMPLEMENTATION_FALSE_COMPLETION",
        message: `Completed work item ${item.workId} must contain validation, evidence, and a completed Completion statement.`,
        file: item.path,
        severity: "error",
      });
    }
  }
  return diagnostics;
};

export const syncImplementation = async (root: string): Promise<string> => {
  const path = resolve(root, "IMPLEMENTATION.md");
  const output = dashboard(await listWorkItems(root));
  await writeFile(path, output, "utf8");
  return output;
};

export const checkImplementation = async (root: string): Promise<CheckResult> => {
  const diagnostics: Diagnostic[] = [];
  const workDirectory = resolve(root, ".thaarei", "work");
  let entries: readonly Dirent[] = [];
  try {
    entries = await readdir(workDirectory, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const parsedItems: WorkItem[] = [];
  for (const entry of entries.filter(
    (candidate) => candidate.isFile() && candidate.name.endsWith(".md"),
  )) {
    const path = join(workDirectory, entry.name);
    try {
      const item = parseWorkItem(await readFile(path, "utf8"), path);
      parsedItems.push(item);
      diagnostics.push(...validateWorkItem(item));
    } catch (error: unknown) {
      diagnostics.push({
        code: "IMPLEMENTATION_INVALID_WORK",
        message: error instanceof Error ? error.message : `Invalid work item ${path}.`,
        file: path,
        severity: "error",
      });
    }
  }
  const activePathOwners = new Map<string, WorkItem>();
  for (const item of parsedItems.filter(
    (candidate) => candidate.status === "in_progress" || candidate.status === "blocked",
  )) {
    for (const affectedPath of item.affectedPaths) {
      const normalizedPath = normalizeAffectedPath(affectedPath);
      if (normalizedPath === undefined) {
        diagnostics.push({
          code: "IMPLEMENTATION_UNSAFE_PATH",
          message: `Active work item ${item.workId} claims an unsafe repository path: ${affectedPath}.`,
          file: item.path,
          severity: "error",
        });
        continue;
      }
      const priorEntry = [...activePathOwners.entries()].find(([priorPath]) =>
        pathsOverlap(priorPath, normalizedPath),
      );
      if (priorEntry !== undefined) {
        const [priorPath, prior] = priorEntry;
        diagnostics.push({
          code: "IMPLEMENTATION_OVERLAPPING_PATH",
          message: `Active work items ${prior.workId} and ${item.workId} overlap on ${priorPath} and ${normalizedPath}.`,
          file: item.path,
          severity: "error",
        });
      } else {
        activePathOwners.set(normalizedPath, item);
      }
    }
  }
  const expected = dashboard(await listWorkItems(root));
  const dashboardPath = resolve(root, "IMPLEMENTATION.md");
  try {
    const actual = await readFile(dashboardPath, "utf8");
    if (actual !== expected)
      diagnostics.push({
        code: "IMPLEMENTATION_STALE",
        message:
          "IMPLEMENTATION.md does not match the canonical work records; run implementation:sync.",
        file: dashboardPath,
        severity: "error",
      });
  } catch {
    diagnostics.push({
      code: "IMPLEMENTATION_MISSING",
      message: "IMPLEMENTATION.md is missing; run implementation:sync.",
      file: dashboardPath,
      severity: "error",
    });
  }
  return { diagnostics, ok: diagnostics.length === 0 };
};
