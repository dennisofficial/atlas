import type { Meta, StoryObj } from "@storybook/react-vite";

import { Separator } from "./separator";

const meta = {
  title: "Display/Separator",
  component: Separator,
  tags: ["autodocs"],
  argTypes: {
    orientation: { control: "select", options: ["horizontal", "vertical"] },
  },
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};

export const WithLabel: Story = {
  args: { label: "Shells" },
};

export const Inset: Story = {
  args: { inset: 8 },
};

export const Vertical: Story = {
  args: { orientation: "vertical", inset: 6 },
  decorators: [
    (Story) => (
      <div className="flex h-12 items-center gap-4">
        <span className="text-base text-meta">left</span>
        <Story />
        <span className="text-base text-meta">right</span>
      </div>
    ),
  ],
};
