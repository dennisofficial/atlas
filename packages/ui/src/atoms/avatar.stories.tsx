import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./avatar";

const meta = {
  title: "Display/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  argTypes: {
    kind: {
      control: "select",
      options: ["user", "agent", "subagent", "service"],
    },
    size: { control: "select", options: ["xs", "sm", "md", "lg"] },
    status: {
      control: "select",
      options: ["running", "awaiting", "failed", "idle"],
    },
  },
  args: { name: "dennis" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllKinds: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Avatar {...args} kind="user" name="dennis" />
      <Avatar {...args} kind="agent" name="atlas" glyph="⏺" />
      <Avatar {...args} kind="subagent" name="classify run" />
      <Avatar {...args} kind="service" name="shell-2" />
    </div>
  ),
};

export const AllSizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Avatar {...args} kind="agent" name="atlas" size="xs" />
      <Avatar {...args} kind="agent" name="atlas" size="sm" />
      <Avatar {...args} kind="agent" name="atlas" size="md" />
      <Avatar {...args} kind="agent" name="atlas" size="lg" />
    </div>
  ),
};

export const WithStatus: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Avatar {...args} kind="agent" name="atlas" glyph="⏺" status="running" />
      <Avatar {...args} kind="agent" name="atlas" glyph="⏺" status="awaiting" />
      <Avatar {...args} kind="agent" name="atlas" glyph="⏺" status="failed" />
      <Avatar {...args} kind="agent" name="atlas" glyph="⏺" status="idle" />
    </div>
  ),
};

const IMAGE_SRC =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='%23d97757'/></svg>";

export const WithImage: Story = {
  args: { src: IMAGE_SRC, name: "dennis" },
};
