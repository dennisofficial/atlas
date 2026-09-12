import type { Meta, StoryObj } from "@storybook/react-vite";

import { Icon } from "./icon";
import { Input } from "./input";

const meta = {
  title: "Forms/Input",
  component: Input,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
  args: { placeholder: "Filter sessions…" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllSizes: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-4">
      <Input {...args} size="sm" placeholder="Small" />
      <Input {...args} size="md" placeholder="Medium" />
      <Input {...args} size="lg" placeholder="Large" />
    </div>
  ),
};

export const WithLabel: Story = {
  args: {
    label: "Worktree",
    mono: true,
    icon: <Icon name="git-branch" size={12} />,
    defaultValue: "dennis/approval-drawer",
  },
};

export const WithSuffix: Story = {
  args: { label: "Budget", suffix: "USD", defaultValue: "12.50" },
};

export const WithHint: Story = {
  args: {
    label: "Session name",
    hint: "Shown in the sidebar and thread list.",
  },
};

export const WithError: Story = {
  args: {
    label: "Budget",
    suffix: "USD",
    defaultValue: "0",
    error: "Must be above the last turn's spend.",
  },
};

export const Disabled: Story = {
  args: { label: "Model", defaultValue: "claude-opus-4-6", disabled: true },
};
