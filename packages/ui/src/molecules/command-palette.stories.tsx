import type { Meta, StoryObj } from "@storybook/react-vite";

import { CommandPalette } from "./command-palette";
import type { PaletteCommand } from "./command-palette";

const commands: PaletteCommand[] = [
  { name: "rewind", summary: "step back to an earlier turn", kind: "cmd" },
  { name: "shells", summary: "every shell this session started", kind: "cmd" },
  {
    name: "model",
    summary: "switch the model for this thread",
    argumentHint: "<model>",
    kind: "cmd",
  },
  {
    name: "review",
    summary: "read the diff and comment",
    argumentHint: "<path>",
    kind: "skill",
  },
  { name: "compact", summary: "summarize the transcript so far", kind: "cmd" },
  {
    name: "commit",
    summary: "stage the work and write the message",
    kind: "skill",
  },
];

const meta = {
  title: "Overlays/CommandPalette",
  component: CommandPalette,
  tags: ["autodocs"],
  args: {
    open: true,
    commands,
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { commands: [] },
};

export const CustomHints: Story = {
  args: {
    placeholder: "Filter commands…",
    footerHint: "↵ run",
  },
};
