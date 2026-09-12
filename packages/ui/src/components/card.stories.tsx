import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";
import { Button } from "./button";
import { Card } from "./card";

const meta = {
  title: "Display/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    surface: { control: "select", options: ["card", "panel", "overlay"] },
  },
  args: {
    title: "apps/tui",
    subtitle: "12 turns · $4.18",
    children: "Card body content sits here.",
  },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHeaderAndFooter: Story = {
  args: {
    badge: (
      <Badge tone="primary" dot>
        running
      </Badge>
    ),
    actions: (
      <Button variant="ghost" size="xs" iconOnly icon={<span>⋯</span>} />
    ),
    footer: <span>last turn 2m ago</span>,
  },
};

export const Rail: Story = {
  args: { rail: true, title: "your draft" },
};

export const Elevated: Story = {
  args: { elevated: true },
};

export const Surfaces: Story = {
  render: (args) => (
    <div className="flex w-[800px] gap-4">
      <Card {...args} surface="card" title="card" />
      <Card {...args} surface="panel" title="panel" />
      <Card {...args} surface="overlay" title="overlay" />
    </div>
  ),
};

export const Unpadded: Story = {
  args: { padded: false },
};
