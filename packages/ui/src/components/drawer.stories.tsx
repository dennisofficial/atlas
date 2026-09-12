import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Drawer } from "./drawer";

const meta = {
  title: "Overlays/Drawer",
  component: Drawer,
  tags: ["autodocs"],
  argTypes: {
    side: { control: "select", options: ["bottom", "top", "right"] },
  },
  args: {
    open: true,
    title: "Atlas is asking before it runs this",
    children: (
      <p className="text-base text-meta">
        bun test --filter harness — runs the harness suite in the current
        worktree.
      </p>
    ),
  },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bottom: Story = {};

export const Right: Story = {
  args: { side: "right", size: 320 },
};

export const Top: Story = {
  args: { side: "top", size: 220 },
};

export const WithHints: Story = {
  args: {
    hints: (
      <>
        <span className="font-mono text-2xs text-hint">Enter to proceed</span>
        <span className="font-mono text-2xs text-hint">Esc to decline</span>
      </>
    ),
    footer: (
      <Button size="sm" variant="primary">
        Proceed
      </Button>
    ),
  },
};

export const NoScrim: Story = {
  args: { scrim: false },
};
