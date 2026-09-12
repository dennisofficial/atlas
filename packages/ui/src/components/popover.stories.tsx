import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Popover } from "./popover";

const meta = {
  title: "Overlays/Popover",
  component: Popover,
  tags: ["autodocs"],
  argTypes: {
    align: { control: "select", options: ["start", "end"] },
  },
  args: {
    title: "Grant",
    trigger: (
      <Button variant="outline" size="sm">
        1 grant
      </Button>
    ),
    children:
      "bun test, granted for this thread. Revoking does not undo what already ran.",
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { open: true },
};

export const WithFooter: Story = {
  args: {
    open: true,
    footer: (
      <Button variant="ghost" size="xs">
        Revoke
      </Button>
    ),
  },
};

export const AlignEnd: Story = {
  args: { open: true, align: "end" },
};
