import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollArea } from "./scroll-area";

const transcriptLines = Array.from(
  { length: 40 },
  (_, i) =>
    `Turn ${i + 1}: the agent reads the file, edits the component, and runs typecheck.`,
);

const meta = {
  title: "Navigation/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderTranscript: Story["render"] = (args) => (
  <ScrollArea {...args}>
    <div className="flex flex-col gap-1.5 p-3 text-base text-foreground">
      {transcriptLines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  </ScrollArea>
);

export const Vertical: Story = {
  args: { maxHeight: 240 },
  render: renderTranscript,
};

export const WithFade: Story = {
  args: { maxHeight: 240, fade: true },
  render: renderTranscript,
};

export const Horizontal: Story = {
  args: { horizontal: true },
  render: (args) => (
    <ScrollArea {...args}>
      <div className="flex gap-2 p-3">
        {Array.from({ length: 20 }, (_, i) => (
          <div
            key={i}
            className="flex h-16 w-32 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-xs text-meta"
          >
            card {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
