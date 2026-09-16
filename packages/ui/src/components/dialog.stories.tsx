import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Dialog } from "./dialog";

const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  args: {
    open: true,
    title: "Discard this turn?",
    description:
      "Rewinding drops the 4 tool calls after it. The files they wrote stay as they are.",
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithFooter: Story = {
  args: {
    hints: <span className="font-mono text-2xs text-hint">Esc to keep it</span>,
    footer: (
      <>
        <Button size="sm">Keep</Button>
        <Button variant="destructive" size="sm">
          Discard
        </Button>
      </>
    ),
  },
};

export const WithBody: Story = {
  args: {
    width: 560,
    children: (
      <p className="text-base text-meta">
        The transcript is kept either way. Discarding only drops the pending
        tool calls and the turn summary.
      </p>
    ),
  },
};
