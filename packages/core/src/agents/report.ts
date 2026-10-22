export enum EReportKind {
  Done = 'done',
  Blocked = 'blocked',
  NeedsDecision = 'needs-decision',
  Progress = 'progress',
}

/** A report with no kind predates typed reports and woke its parent, so it still does. */
export const reportWakesParent = (kind: EReportKind | undefined): boolean =>
  kind !== EReportKind.Progress
