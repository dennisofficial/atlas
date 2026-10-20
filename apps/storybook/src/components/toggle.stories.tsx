import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoldIcon } from "lucide-react";

import { Toggle } from "@dltech/atlas-ui/components/toggle";

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "outline"] },
    size: { control: "inline-radio", options: ["default", "sm", "lg"] },
    disabled: { control: "boolean" },
  },
  args: { variant: "default", size: "default", "aria-label": "Toggle bold" },
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Toggle {...args}>
      <BoldIcon />
    </Toggle>
  ),
};

export const Outline: Story = {
  args: { variant: "outline" },
  render: Default.render,
};

export const WithText: Story = {
  render: (args) => (
    <Toggle {...args} aria-label="Toggle reasoning">
      <BoldIcon data-icon="inline-start" />
      Reasoning
    </Toggle>
  ),
};

export const Pressed: Story = {
  args: { defaultPressed: true },
  render: Default.render,
};

export const Disabled: Story = {
  args: { disabled: true },
  render: Default.render,
};
