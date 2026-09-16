import type { Meta, StoryObj } from "@storybook/react-vite";

import { Icon } from "./icon";

const meta = {
  title: "Iconography/Icon",
  component: Icon,
  tags: ["autodocs"],
  argTypes: {
    name: {
      control: "select",
      options: [
        "terminal",
        "git-branch",
        "circle-check",
        "circle-dot",
        "file-diff",
        "folder",
        "sparkles",
        "triangle-alert",
        "x",
      ],
    },
    size: { control: "select", options: [12, 14, 16] },
    strokeWidth: { control: { type: "range", min: 1, max: 3, step: 0.25 } },
  },
  args: { name: "terminal" },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-3 text-foreground">
      <Icon {...args} size={12} />
      <Icon {...args} size={14} />
      <Icon {...args} size={16} />
    </div>
  ),
};

export const StatusColor: Story = {
  args: { name: "circle-dot", size: 12, title: "Agent working" },
  render: (args) => (
    <span className="inline-flex items-center gap-1.5 text-sm text-primary">
      <Icon {...args} />
      Agent working
    </span>
  ),
};

export const InheritColor: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <span className="inline-flex items-center gap-1.5 text-sm text-meta">
        <Icon {...args} name="git-branch" />
        main
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm text-success">
        <Icon {...args} name="circle-check" />
        Passed
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <Icon {...args} name="triangle-alert" />
        Failed
      </span>
    </div>
  ),
};
