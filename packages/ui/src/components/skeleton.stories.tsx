import type { Meta, StoryObj } from "@storybook/react-vite";

import { Skeleton } from "./skeleton";

const meta = {
  title: "Display/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomSize: Story = {
  args: { width: 120, height: 18 },
};

export const Lines: Story = {
  args: { lines: 3 },
};

export const MonoLines: Story = {
  args: { lines: 4, mono: true },
};

export const Round: Story = {
  args: { width: 32, height: 32, radius: "var(--radius-full)" },
};
