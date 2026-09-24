import type { Meta, StoryObj } from "@storybook/react-vite";

import { Spinner } from "./spinner";

const meta = {
  title: "Feedback/Spinner",
  component: Spinner,
  tags: ["autodocs"],
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InlineWithText: Story = {
  render: (args) => (
    <span className="inline-flex items-center gap-2">
      <Spinner {...args} />
      working
    </span>
  ),
};
