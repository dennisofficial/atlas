import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiffViewer } from "./diff-viewer";

const meta = {
  title: "Agent/DiffViewer",
  component: DiffViewer,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiffViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  args: {
    path: "tokens/semantic.css",
    added: 18,
    removed: 4,
    hunk: "@@ -12,7 +12,21 @@",
    lines: [
      {
        kind: "context",
        text: "  --background: #282422;",
        oldNumber: 12,
        newNumber: 12,
      },
      { kind: "remove", text: "  --primary: #c9700a;", oldNumber: 13 },
      { kind: "add", text: "  --primary: #d97757;", newNumber: 13 },
      { kind: "add", text: "  --primary-foreground: #241f1c;", newNumber: 14 },
      {
        kind: "context",
        text: "  --secondary: #332e2a;",
        oldNumber: 14,
        newNumber: 15,
      },
      { kind: "gap", text: "12 unchanged lines" },
      { kind: "remove", text: "  --band-agent: #4a2a1a;", oldNumber: 27 },
      { kind: "add", text: "  --band-agent: #3d2318;", newNumber: 28 },
    ],
  },
};

export const SplitMode: Story = {
  args: {
    ...Inline.args,
    mode: "split",
  },
};

export const NoCounts: Story = {
  args: {
    path: "apps/tui/src/ui/palette.ts",
    lines: [
      {
        kind: "context",
        text: "export const palette = {",
        oldNumber: 1,
        newNumber: 1,
      },
      { kind: "remove", text: "  primary: '#c9700a',", oldNumber: 2 },
      { kind: "add", text: "  primary: '#d97757',", newNumber: 2 },
      { kind: "context", text: "};", oldNumber: 3, newNumber: 3 },
    ],
  },
};
