import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Select, type SelectOption } from "./select";

const effortOptions: SelectOption[] = [
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
];

const meta = {
  title: "Forms/Select",
  component: Select,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
  args: { options: effortOptions, value: "high", onChange: () => {} },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Reasoning effort", mono: true },
};

export const AllSizes: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-4">
      <Select {...args} size="sm" />
      <Select {...args} size="md" />
      <Select {...args} size="lg" />
    </div>
  ),
};

export const WithPlaceholder: Story = {
  args: {
    label: "Density",
    placeholder: "Pick a density…",
    value: "",
    options: [
      { value: "dense", label: "Dense" },
      { value: "default", label: "Default" },
      { value: "comfortable", label: "Comfortable" },
    ],
  },
};

export const WithHint: Story = {
  args: {
    label: "Theme",
    options: [
      { value: "night", label: "Night" },
      { value: "day", label: "Day" },
    ],
    value: "night",
    hint: "Day theme is still settling in.",
  },
};

export const Invalid: Story = {
  args: { label: "Reasoning effort", invalid: true },
};

export const Disabled: Story = {
  args: { label: "Reasoning effort", disabled: true },
};

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState("high");
    return (
      <Select
        label="Reasoning effort"
        mono
        options={effortOptions}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  },
};
