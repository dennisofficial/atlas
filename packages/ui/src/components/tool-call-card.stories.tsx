import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiffViewer } from "./diff-viewer";
import { ToolCallCard } from "./tool-call-card";

const meta = {
  title: "Agent/ToolCallCard",
  component: ToolCallCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadRun: Story = {
  args: {
    kind: "read",
    sentence: "Read 14 files across 3 directories",
    measure: "1.2k lines",
    rows: [
      { label: "apps/tui/src/ui/palette.ts", note: "103 lines" },
      { label: "tokens/semantic.css", note: "212 lines" },
      { label: "deprecated/web/src/theme.ts", note: "98 lines" },
    ],
  },
};

export const Running: Story = {
  args: {
    kind: "shell",
    state: "running",
    sentence: "bun test apps/tui",
  },
};

export const Failed: Story = {
  args: {
    kind: "shell",
    state: "failed",
    sentence: "bun run typecheck",
    note: "exit 1",
    children: (
      <pre className="m-0 overflow-auto rounded-xs bg-surface-panel p-3 font-mono text-xs text-destructive">
        {
          "error TS2322: Type 'string' is not assignable to type 'DiffLineKind'.\n  src/components/diff-viewer.tsx:41:7"
        }
      </pre>
    ),
  },
};

export const EditWithDiff: Story = {
  args: {
    kind: "edit",
    sentence: "Edit tokens/semantic.css",
    note: "+18 −4",
    detail: (
      <DiffViewer
        path="tokens/semantic.css"
        added={2}
        removed={1}
        hunk="@@ -12,3 +12,4 @@"
        lines={[
          {
            kind: "context",
            text: "  --background: #282422;",
            oldNumber: 12,
            newNumber: 12,
          },
          { kind: "remove", text: "  --primary: #c9700a;", oldNumber: 13 },
          { kind: "add", text: "  --primary: #d97757;", newNumber: 13 },
        ]}
      />
    ),
  },
};

export const Skill: Story = {
  args: {
    kind: "skill",
    sentence: "Skill: reviewed the diff against the tokens contract",
    note: "2 findings",
  },
};
