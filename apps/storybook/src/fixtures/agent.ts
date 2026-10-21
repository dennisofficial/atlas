import {
  EFileChange,
  type FileNode,
} from "@dltech/atlas-ui/ai/file-tree";
import type { DiffLine } from "@dltech/atlas-ui/ai/diff-viewer";
import type { ModelOption } from "@dltech/atlas-ui/ai/model-selector";
import { EStepStatus, type PlanStep } from "@dltech/atlas-ui/ai/plan";
import type { QueueTodo } from "@dltech/atlas-ui/ai/queue";
import type { Source } from "@dltech/atlas-ui/ai/sources";
import {
  ETestStatus,
  type TestSuite,
} from "@dltech/atlas-ui/ai/test-results";

export const GIT_STATUS_OUTPUT = ` M packages/ui/src/tokens/semantic.ts
 M packages/ui/src/styles/theme.css
?? packages/ui/src/ai/tool.tsx`;

export const BUN_TEST_OUTPUT = `bun test v1.3.4

packages/ui/src/tokens/__tests__/tokens.spec.ts:
(pass) theme.css matches the generated output [4.12ms]
(pass) every semantic key is mapped [0.31ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [182.00ms]`;

export const TYPECHECK_OUTPUT = `$ tsc --noEmit
src/ai/tool.tsx(41,9): error TS2322: Type 'string' is not assignable to type 'EToolState'.
src/ai/tool.tsx(58,3): error TS2741: Property 'label' is missing in type '{}' but required in type 'ToolProps'.

Found 2 errors in 1 file.`;

export const TYPE_ERROR_STACK = `TypeError: Cannot read properties of undefined (reading 'tokens')
    at buildThemeCss (packages/ui/src/tokens/css.ts:42:31)
    at generate (packages/ui/tools/generate-css.ts:18:12)
    at main (packages/ui/tools/generate-css.ts:30:3)
    at Module.run (node_modules/bun/internal/run.js:204:5)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

export const REASONING_TEXT = `The theme comes from src/tokens, and theme.css is generated from it. A spec fails when they drift, so I should edit the tokens and regenerate rather than touch the CSS by hand.

I also need to check which utilities the old diff viewer used, because two of them no longer exist.`;

export const PLAN_STEPS: PlanStep[] = [
  { id: "1", title: "Map tokens onto shadcn variable names", status: EStepStatus.Done },
  { id: "2", title: "Regenerate theme.css", status: EStepStatus.Running },
  { id: "3", title: "Restyle the diff viewer", status: EStepStatus.Pending },
  { id: "4", title: "Run the token and ui specs", status: EStepStatus.Pending },
];

export const TODOS: QueueTodo[] = [
  {
    id: "1",
    title: "Fix the focus ring on the select trigger",
    description: "It is clipped by overflow-hidden on the field.",
    done: false,
  },
  { id: "2", title: "Update the registry snapshots", done: false },
  {
    id: "3",
    title: "Add tests for the combobox",
    description: "Typing, clearing and keyboard selection.",
    done: false,
  },
  { id: "4", title: "Add a changeset", done: true },
  {
    id: "5",
    title: "Write the migration guide",
    description: "Cover the renamed props and the new data attributes.",
    done: true,
  },
];

export const MODELS: ModelOption[] = [
  {
    id: "claude-opus",
    label: "Claude Opus",
    provider: "Anthropic",
    context: "1M",
    rate: "$$$",
  },
  {
    id: "claude-sonnet",
    label: "Claude Sonnet",
    provider: "Anthropic",
    context: "1M",
    rate: "$$",
  },
  {
    id: "gpt-codex",
    label: "GPT Codex",
    provider: "OpenAI",
    context: "400k",
    rate: "$$",
  },
  {
    id: "gpt-mini",
    label: "GPT mini",
    provider: "OpenAI",
    context: "400k",
    rate: "$",
  },
];

export const SOURCES: Source[] = [
  {
    url: "https://ui.shadcn.com/docs/ai-elements/base/tool",
    title: "Tool — shadcn/ui",
  },
  { url: "https://base-ui.com/react/components/collapsible" },
  { url: "https://tailwindcss.com/docs/theme", title: "Theme variables" },
];

export const SUGGESTIONS = [
  "Fix the failing typecheck",
  "Explain the token generator",
  "Add a story for the plan pattern",
  "Summarize the diff",
  "Run the full test suite",
];

export const CHANGED_FILES: FileNode[] = [
  {
    path: "packages/ui",
    name: "packages/ui",
    children: [
      {
        path: "packages/ui/src/ai",
        name: "src/ai",
        children: [
          {
            path: "packages/ui/src/ai/tool.tsx",
            name: "tool.tsx",
            change: EFileChange.Added,
          },
          {
            path: "packages/ui/src/ai/diff-viewer.tsx",
            name: "diff-viewer.tsx",
            change: EFileChange.Modified,
          },
        ],
      },
      {
        path: "packages/ui/src/styles",
        name: "src/styles",
        children: [
          {
            path: "packages/ui/src/styles/theme.css",
            name: "theme.css",
            change: EFileChange.Modified,
          },
        ],
      },
    ],
  },
  {
    path: "apps/web/src/app/page.tsx",
    name: "apps/web/src/app/page.tsx",
    change: EFileChange.Deleted,
  },
];

export const TEST_SUITES: TestSuite[] = [
  {
    name: "tokens.spec.ts",
    tests: [
      { name: "theme.css matches the generated output", status: ETestStatus.Passed },
      { name: "every semantic key is mapped", status: ETestStatus.Passed },
      { name: "emits a light block", status: ETestStatus.Passed },
    ],
  },
  {
    name: "diff-viewer.spec.tsx",
    tests: [
      { name: "renders add, remove and gap rows", status: ETestStatus.Passed },
      {
        name: "numbers split rows with two gutters",
        status: ETestStatus.Failed,
        error: `Expected: ["1", "1"]
Received: ["1"]

  at Object.<anonymous> (src/ai/__tests__/diff-viewer.spec.tsx:45:12)`,
      },
      { name: "truncates long lines", status: ETestStatus.Skipped },
    ],
  },
];

export const DIFF_LINES: DiffLine[] = [
  { kind: "context", text: "  --background: oklch(0.18 0.01 60);", oldNumber: 12, newNumber: 12 },
  { kind: "remove", text: "  --primary: oklch(0.62 0.15 55);", oldNumber: 13 },
  { kind: "add", text: "  --primary: oklch(0.68 0.14 45);", newNumber: 13 },
  { kind: "add", text: "  --primary-foreground: oklch(0.2 0.01 50);", newNumber: 14 },
  { kind: "context", text: "  --secondary: oklch(0.24 0.01 60);", oldNumber: 14, newNumber: 15 },
  { kind: "gap", text: "12 unchanged lines" },
  { kind: "remove", text: "  --diff-add: oklch(0.3 0.06 150);", oldNumber: 27 },
  { kind: "add", text: "  --diff-add: oklch(0.32 0.07 150);", newNumber: 28 },
];

export const LONG_DIFF_LINES: DiffLine[] = [
  {
    kind: "add",
    text: "export const description = 'A very long line that keeps going past the edge of the viewer so that truncation has something to do';",
    newNumber: 1,
  },
  ...DIFF_LINES,
];

export const THREADS = [
  { id: "t1", title: "Rebase ui on shadcn base-nova", meta: "running · 3m" },
  { id: "t2", title: "Fix device auth redirect", meta: "2h ago" },
  { id: "t3", title: "Storybook coverage spec", meta: "yesterday" },
  { id: "t4", title: "Sandbox image cache", meta: "2d ago" },
];
