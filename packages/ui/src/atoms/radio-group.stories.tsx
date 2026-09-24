import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Radio, type RadioOption } from "./radio-group";

const approvalOptions: RadioOption[] = [
  { value: "proceed", label: "Proceed" },
  {
    value: "always",
    label: "Proceed, and stop asking about bun test",
    hint: "Grants for this thread.",
  },
  { value: "decline", label: "Decline" },
];

const meta = {
  title: "Forms/Radio",
  component: Radio,
  tags: ["autodocs"],
  args: { options: approvalOptions, value: "proceed", onChange: () => {} },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHints: Story = {
  args: {
    options: [
      {
        value: "inline",
        label: "Inline diffs",
        hint: "One column, additions under removals.",
      },
      {
        value: "split",
        label: "Side-by-side diffs",
        hint: "Falls back to inline under 140 columns.",
      },
      {
        value: "off",
        label: "No diff",
        hint: "Approvals show the command only.",
      },
    ],
    value: "split",
  },
};

export const WithDisabledOption: Story = {
  args: {
    options: [
      { value: "fast", label: "Fast model" },
      {
        value: "deep",
        label: "Deep model",
        hint: "Unavailable on this plan.",
        disabled: true,
      },
    ],
    value: "fast",
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Interactive: Story = {
  render: function Render() {
    const [value, setValue] = useState("proceed");
    return (
      <Radio
        options={approvalOptions}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  },
};
