export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly severity: DiagnosticSeverity;
}

export interface CheckResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
}

export const isDiagnosticError = (diagnostic: Diagnostic): boolean =>
  diagnostic.severity === "error";
