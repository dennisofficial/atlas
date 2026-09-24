import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { DropdownMenu } from "./dropdown-menu";
import type { DropdownMenuItem } from "./dropdown-menu";

const items: DropdownMenuItem[] = [
  { kind: "label", label: "Turn" },
  { label: "Rewind to here", kbd: "⌘Z" },
  { label: "Copy transcript", kbd: "⌘C", checked: true },
  { label: "Rename session", disabled: true },
  { kind: "separator" },
  { label: "Delete session", destructive: true },
];

const meta = {
  title: "Overlays/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  argTypes: {
    align: { control: "select", options: ["start", "end"] },
  },
  args: {
    trigger: (
      <Button variant="ghost" size="sm">
        Session
      </Button>
    ),
    items,
  },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AlignEnd: Story = {
  args: { align: "end" },
};

export const Narrow: Story = {
  args: { width: 180 },
};
