import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodeBlock } from "./code-block";

const SAMPLE = `export const theme: Palette = {
  appBg: '#282422', // warm-900
  caret: '#d97757',
};

export function apply(name: string): boolean {
  return name === "atlas";
}`;

const meta = {
  title: "Display/CodeBlock",
  component: CodeBlock,
  tags: ["autodocs"],
  args: {
    code: SAMPLE,
    filename: "apps/tui/src/ui/palette.ts",
    language: "ts",
  },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LineNumbers: Story = {
  args: { lineNumbers: true, startLine: 54 },
};

export const NoHeader: Story = {
  render: ({ code }) => <CodeBlock code={code} copyable={false} />,
};

export const MaxHeight: Story = {
  args: { maxHeight: 120, lineNumbers: true },
};
