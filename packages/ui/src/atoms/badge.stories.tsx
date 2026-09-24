import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";

const meta = {
  title: "Display/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: [
        "neutral",
        "primary",
        "success",
        "warning",
        "destructive",
        "code",
        "external",
      ],
    },
    variant: { control: "select", options: ["soft", "solid", "bare"] },
  },
  args: { children: "running", tone: "primary" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllTones: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-4">
      <Badge {...args} tone="neutral">
        idle
      </Badge>
      <Badge {...args} tone="primary">
        running
      </Badge>
      <Badge {...args} tone="success">
        passed
      </Badge>
      <Badge {...args} tone="warning">
        awaiting input
      </Badge>
      <Badge {...args} tone="destructive">
        failed
      </Badge>
      <Badge {...args} tone="code">
        claude-sonnet-4-6
      </Badge>
      <Badge {...args} tone="external">
        web
      </Badge>
    </div>
  ),
};

export const Solid: Story = {
  args: { variant: "solid", tone: "warning", children: "awaiting input" },
};

export const Bare: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Badge {...args} variant="bare" tone="success">
        passed
      </Badge>
      <Badge {...args} variant="bare" tone="destructive">
        failed
      </Badge>
      <Badge {...args} variant="bare" tone="neutral">
        skipped
      </Badge>
    </div>
  ),
};

export const WithDot: Story = {
  args: { dot: true, tone: "primary", children: "running" },
};

export const WithIcon: Story = {
  args: { icon: <span>✓</span>, tone: "success", children: "passed" },
};

export const Mono: Story = {
  args: { mono: true, tone: "code", children: "claude-sonnet-4-6" },
};
