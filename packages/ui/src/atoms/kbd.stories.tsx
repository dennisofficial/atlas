import type { Meta, StoryObj } from "@storybook/react-vite";

import { Kbd } from "./kbd";

const meta = {
  title: "Display/Kbd",
  component: Kbd,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md"] },
  },
  args: { keys: ["Enter"] },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  args: { keys: ["Enter"], label: "to proceed" },
};

export const Chord: Story = {
  args: { keys: ["⌘", "K"] },
};

export const Small: Story = {
  args: { keys: ["↑"], label: "to edit", size: "sm" },
};

export const Children: Story = {
  render: () => <Kbd label="to cancel">esc</Kbd>,
};
