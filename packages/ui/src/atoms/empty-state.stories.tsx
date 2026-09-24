import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { Kbd } from "./kbd";

const meta = {
  title: "Display/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  args: {
    glyph: "⏺",
    title: "No sessions in this repo",
    body: "A session is one conversation against one worktree. Start one and Atlas picks up the branch you are on.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: (
      <Button variant="primary" size="sm">
        New session
      </Button>
    ),
  },
};

export const WithHints: Story = {
  args: {
    action: (
      <Button variant="primary" size="sm">
        New session
      </Button>
    ),
    hints: [
      <Kbd key="search" keys={["⌘", "K"]} label="to search" />,
      <Kbd key="new" keys={["⌘", "N"]} label="for a new session" />,
    ],
  },
};

export const Compact: Story = {
  args: {
    compact: true,
    title: "No sessions",
    body: "Start one from the sidebar.",
  },
};
