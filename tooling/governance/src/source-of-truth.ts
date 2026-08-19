import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { CheckResult, Diagnostic } from "./types.js";

export const SOURCE_OF_TRUTH_FIELDS = [
  "SOURCE OF TRUTH ID",
  "SOURCE OF TRUTH KEYWORDS",
  "WHAT",
  "WHY",
  "WHEN",
  "HOW",
  "BOUNDARIES",
] as const;

type SourceOfTruthField = (typeof SOURCE_OF_TRUTH_FIELDS)[number];

interface SourceOfTruthBlock {
  readonly fields: ReadonlyMap<SourceOfTruthField, string>;
  readonly line: number;
  readonly endLine: number;
  readonly endOffset: number;
  readonly source: string;
}

interface ArchitecturalOwner {
  readonly name: string;
  readonly line: number;
  readonly endOffset: number;
  readonly body?: string;
  readonly file: string;
  readonly declaration: string;
}

export interface SourceOfTruthRecord {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly what: string;
  readonly why: string;
  readonly when: string;
  readonly how: string;
  readonly boundaries: string;
  readonly owner: string;
  readonly file: string;
  readonly line: number;
}

export interface SourceOfTruthOptions {
  readonly roots?: readonly string[];
  readonly include?: readonly string[];
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tooling",
  "tests",
  "__tests__",
  "fixtures",
]);

const ARCHITECTURAL_DECLARATION =
  /\bexport\s+(?:(?:default|abstract)\s+)?(?:async\s+)?(?:class|function|const|let)\s+([A-Za-z_$][\w$]*)/g;
const FIRST_ARCHITECTURAL_DECLARATION =
  /^\s*export\s+(?:(?:default|abstract)\s+)?(?:async\s+)?(?:class|function|const|let)\s+[A-Za-z_$][\w$]*/u;

const collectFiles = async (root: string): Promise<readonly string[]> => {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        await visit(join(directory, entry.name));
      } else if (
        entry.isFile() &&
        (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx") &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(join(directory, entry.name));
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
};

const lineNumberAt = (source: string, offset: number): number =>
  source.slice(0, offset).split("\n").length;

const parseBlock = (source: string, start: number, end: number): SourceOfTruthBlock => {
  const blockSource = source.slice(start, end);
  const lines = blockSource.split("\n");
  const fields = new Map<SourceOfTruthField, string>();
  for (const line of lines) {
    const match =
      /^\s*\*?\s*(SOURCE OF TRUTH ID|SOURCE OF TRUTH KEYWORDS|WHAT|WHY|WHEN|HOW|BOUNDARIES)\s*:\s*(.*?)\s*$/u.exec(
        line,
      );
    if (match === null) continue;
    const field = match[1];
    const value = match[2];
    if (field === undefined || value === undefined) continue;
    if (isSourceOfTruthField(field)) fields.set(field, value);
  }
  return {
    fields,
    line: lineNumberAt(source, start),
    endLine: lineNumberAt(source, end),
    endOffset: end,
    source: blockSource,
  };
};

const isSourceOfTruthField = (value: string): value is SourceOfTruthField =>
  SOURCE_OF_TRUTH_FIELDS.some((field) => field === value);

const collectBlocks = (source: string): readonly SourceOfTruthBlock[] => {
  const blocks: SourceOfTruthBlock[] = [];
  const expression = /\/\*\*?[\s\S]*?\*\//g;
  for (const match of source.matchAll(expression)) {
    const value = match[0];
    if (!/SOURCE OF TRUTH ID\s*:/u.test(value)) continue;
    const start = match.index ?? 0;
    blocks.push(parseBlock(source, start, start + value.length));
  }
  return blocks;
};

const declarationOwners = (source: string, file: string): readonly ArchitecturalOwner[] => {
  const owners: ArchitecturalOwner[] = [];
  for (const match of source.matchAll(ARCHITECTURAL_DECLARATION)) {
    const name = match[1];
    if (name === undefined) continue;
    const start = match.index ?? 0;
    const bodyStart = source.indexOf("{", start);
    const endOffset = bodyStart < 0 ? source.length : findMatchingBrace(source, bodyStart);
    const body =
      bodyStart < 0 || endOffset < 0 ? undefined : source.slice(bodyStart + 1, endOffset);
    const newline = source.indexOf("\n", start);
    const declarationEnd = bodyStart < 0 ? (newline < 0 ? source.length : newline) : endOffset + 1;
    const declaration = source.slice(start, declarationEnd);
    const owner = { name, line: lineNumberAt(source, start), endOffset, file, declaration };
    owners.push(body === undefined ? owner : { ...owner, body });
  }
  return owners;
};

const findMatchingBrace = (source: string, opening: number): number => {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const isTrivialOwner = (owner: ArchitecturalOwner): boolean => {
  if (owner.body === undefined) return /=>\s*[^{};]+;?$/u.test(owner.declaration);
  const body = owner.body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gmu, "")
    .trim();
  if (body.length === 0 || body.length > 220) return false;
  if (/^return\s+[^;{}]+;?$/u.test(body)) return true;
  if (/^(?:throw|yield)\s+[^;{}]+;?$/u.test(body)) return true;
  return false;
};

const isGenericDumpingGround = (owner: ArchitecturalOwner): boolean => {
  if (/^(?:utils?|helpers?|common|misc|shared)$/iu.test(owner.name)) return true;
  return owner.file
    .split(/[\\/]/u)
    .some((segment) =>
      /^(?:utils?|helpers?|common|misc)$/iu.test(segment.replace(/\.[^.]+$/u, "")),
    );
};

const declaredNames = (source: string): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const match of source.matchAll(/\b(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
};

const howReferencesDeclaredSymbol = (how: string, source: string): boolean => {
  const names = declaredNames(source);
  const quotedNames = [...how.matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)`/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  if (quotedNames.length > 0) {
    return quotedNames.every((name) => name.split(".").every((part) => names.has(part)));
  }
  return [...names].some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "u").test(how));
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ownerAfterBlock = (
  source: string,
  block: SourceOfTruthBlock,
  file: string,
): ArchitecturalOwner | undefined => {
  const remainder = source.slice(block.endOffset);
  if (FIRST_ARCHITECTURAL_DECLARATION.exec(remainder) === null) return undefined;
  const owners = declarationOwners(remainder, file);
  const first = owners[0];
  return first === undefined ? undefined : { ...first, line: first.line + block.line - 1 };
};

const makeDiagnostic = (code: string, message: string, file: string, line: number): Diagnostic => ({
  code,
  message,
  file,
  line,
  severity: "error",
});

export const parseSourceOfTruthRecords = (
  source: string,
  file: string,
): {
  readonly records: readonly SourceOfTruthRecord[];
  readonly diagnostics: readonly Diagnostic[];
} => {
  const records: SourceOfTruthRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  const blocks = collectBlocks(source);
  for (const block of blocks) {
    const missing = SOURCE_OF_TRUTH_FIELDS.filter((field) => {
      const value = block.fields.get(field);
      return value === undefined || value.trim().length === 0;
    });
    if (missing.length > 0) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_MISSING_FIELD",
          `Source-of-truth block is missing: ${missing.join(", ")}.`,
          file,
          block.line,
        ),
      );
      continue;
    }
    const owner = ownerAfterBlock(source, block, file);
    if (owner === undefined) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_NO_OWNER",
          "Source-of-truth block must immediately precede an exported architectural owner.",
          file,
          block.line,
        ),
      );
      continue;
    }
    if (isTrivialOwner(owner)) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_TRIVIAL_OWNER",
          `Source-of-truth metadata is not allowed on trivial helper ${owner.name}.`,
          file,
          owner.line,
        ),
      );
    }
    if (isGenericDumpingGround(owner)) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_GENERIC_DUMPING_GROUND",
          `Source-of-truth metadata is not allowed on generic utility owner ${owner.name}; define a focused architectural boundary.`,
          file,
          owner.line,
        ),
      );
    }
    const id = block.fields.get("SOURCE OF TRUTH ID") ?? "";
    const keywordText = block.fields.get("SOURCE OF TRUTH KEYWORDS") ?? "";
    const keywords = keywordText
      .split(",")
      .map((keyword) => keyword.trim().toLowerCase())
      .filter((keyword) => keyword.length > 0);
    records.push({
      id,
      keywords,
      what: block.fields.get("WHAT") ?? "",
      why: block.fields.get("WHY") ?? "",
      when: block.fields.get("WHEN") ?? "",
      how: block.fields.get("HOW") ?? "",
      boundaries: block.fields.get("BOUNDARIES") ?? "",
      owner: owner.name,
      file,
      line: block.line,
    });
    if (!howReferencesDeclaredSymbol(block.fields.get("HOW") ?? "", source)) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_STALE_HOW",
          `HOW does not reference a declared symbol in ${file}.`,
          file,
          block.line,
        ),
      );
    }
  }
  return { records, diagnostics };
};

export const checkSourceOfTruth = async (
  root: string,
  options: SourceOfTruthOptions = {},
): Promise<CheckResult & { readonly records: readonly SourceOfTruthRecord[] }> => {
  const absoluteRoot = resolve(root);
  const roots = options.roots ?? [absoluteRoot];
  const files = (
    await Promise.all(roots.map((entry) => collectFiles(resolve(absoluteRoot, entry))))
  ).flat();
  const diagnostics: Diagnostic[] = [];
  const records: SourceOfTruthRecord[] = [];
  for (const file of [...new Set(files)].sort()) {
    const source = await readFile(file, "utf8");
    const parsed = parseSourceOfTruthRecords(source, file);
    diagnostics.push(...parsed.diagnostics);
    records.push(...parsed.records);
  }
  const byId = new Map<string, SourceOfTruthRecord>();
  const byOwner = new Map<string, SourceOfTruthRecord>();
  const byKeywordSet = new Map<string, SourceOfTruthRecord>();
  for (const record of records) {
    const priorId = byId.get(record.id);
    if (priorId !== undefined) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_DUPLICATE_ID",
          `Source-of-truth ID ${record.id} is already owned by ${priorId.owner}.`,
          record.file,
          record.line,
        ),
      );
    } else byId.set(record.id, record);
    const ownerKey = `${record.file}:${record.owner}`;
    const priorOwner = byOwner.get(ownerKey);
    if (priorOwner !== undefined) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_OVERLAPPING_OWNER",
          `Architectural owner ${record.owner} has more than one source-of-truth block.`,
          record.file,
          record.line,
        ),
      );
    } else byOwner.set(ownerKey, record);
    const keywordSet = [...new Set(record.keywords)].sort().join("|");
    const priorKeywords = byKeywordSet.get(keywordSet);
    if (
      keywordSet.length > 0 &&
      priorKeywords !== undefined &&
      priorKeywords.owner !== record.owner
    ) {
      diagnostics.push(
        makeDiagnostic(
          "SOT_OVERLAPPING_KEYWORD",
          `Keyword set ${record.keywords.join(", ")} is owned by both ${priorKeywords.owner} and ${record.owner}.`,
          record.file,
          record.line,
        ),
      );
    } else if (keywordSet.length > 0) {
      byKeywordSet.set(keywordSet, record);
    }
  }
  return {
    diagnostics,
    records,
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
  };
};
