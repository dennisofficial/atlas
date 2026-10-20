import {
  EFileChange,
  type ChangedFile,
  type ChangeScopeOption,
} from "@dltech/atlas-ui/ai/changes-panel";
import type { DiffLine } from "@dltech/atlas-ui/ai/diff-viewer";

import { DIFF_LINES } from "../../../fixtures/agent";

const THEME_LINES: DiffLine[] = [
  { kind: "context", text: ":root {", oldNumber: 1, newNumber: 1 },
  { kind: "remove", text: "  --primary: oklch(0.62 0.15 55);", oldNumber: 2 },
  { kind: "add", text: "  --primary: oklch(0.68 0.14 45);", newNumber: 2 },
  { kind: "add", text: "  --primary-foreground: oklch(0.2 0.01 50);", newNumber: 3 },
  { kind: "gap", text: "2,056 generated lines" },
];

const DIFF_VIEWER_LINES: DiffLine[] = [
  { kind: "context", text: "export function DiffViewer({ path, lines }: DiffViewerProps) {", oldNumber: 48, newNumber: 48 },
  { kind: "remove", text: "  const rows = lines.map((line) => toRow(line, mode));", oldNumber: 49 },
  { kind: "remove", text: "  const gutter = mode === 'split' ? 2 : 1;", oldNumber: 50 },
  { kind: "add", text: "  const rows = lines.map((line) => toRow({ line, mode }));", newNumber: 49 },
  { kind: "add", text: "  const gutter = GUTTERS[mode];", newNumber: 50 },
  { kind: "context", text: "  return <DiffTable rows={rows} gutter={gutter} />;", oldNumber: 51, newNumber: 51 },
];

const TOOL_LINES: DiffLine[] = [
  { kind: "add", text: 'import { Trace } from "#components/trace";', newNumber: 1 },
  { kind: "add", text: 'import { EToolKind, TOOL_KINDS } from "./internal/kinds";', newNumber: 2 },
  { kind: "add", text: "", newNumber: 3 },
  { kind: "add", text: "export enum EToolState {", newNumber: 4 },
  { kind: "add", text: '  Running = "running",', newNumber: 5 },
  { kind: "add", text: '  Done = "done",', newNumber: 6 },
  { kind: "gap", text: "113 more lines" },
];

const PAGE_LINES: DiffLine[] = [
  { kind: "remove", text: 'export { default } from "../legacy/home";', oldNumber: 1 },
];

export const SESSION_FILES: ChangedFile[] = [
  {
    path: "packages/ui/src/tokens/semantic.ts",
    added: 4,
    removed: 2,
    change: EFileChange.Modified,
    hunk: "@@ -12,7 +12,21 @@",
    lines: DIFF_LINES,
  },
  {
    path: "packages/ui/src/styles/theme.css",
    added: 2060,
    removed: 1,
    change: EFileChange.Modified,
    hunk: "@@ -1,4 +1,2063 @@",
    lines: THEME_LINES,
  },
  {
    path: "packages/ui/src/ai/tool.tsx",
    added: 119,
    removed: 0,
    change: EFileChange.Added,
    hunk: "@@ -0,0 +1,119 @@",
    lines: TOOL_LINES,
  },
  {
    path: "packages/ui/src/ai/diff-viewer.tsx",
    added: 14,
    removed: 2,
    change: EFileChange.Modified,
    hunk: "@@ -48,4 +48,16 @@",
    lines: DIFF_VIEWER_LINES,
  },
  {
    path: "apps/web/src/app/page.tsx",
    added: 0,
    removed: 1,
    change: EFileChange.Deleted,
    hunk: "@@ -1 +0,0 @@",
    lines: PAGE_LINES,
  },
];

export const CHANGE_SCOPES: ChangeScopeOption[] = [
  { id: "all", label: "All changes", detail: "4 commits ahead of origin/main" },
  { id: "uncommitted", label: "Uncommitted", detail: "2 files" },
  { id: "last-commit", label: "Last commit", detail: "refactor(ui): map tokens onto shadcn names" },
];

const SCOPE_PATHS: Record<string, string[] | undefined> = {
  uncommitted: [
    "packages/ui/src/ai/tool.tsx",
    "packages/ui/src/ai/diff-viewer.tsx",
  ],
  "last-commit": ["packages/ui/src/tokens/semantic.ts"],
};

export function filesInScope(scope: string): ChangedFile[] {
  const paths = SCOPE_PATHS[scope];
  if (!paths) return SESSION_FILES;
  return SESSION_FILES.filter((file) => paths.includes(file.path));
}
