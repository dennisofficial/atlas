import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Checkbox } from "./checkbox";

const meta = {
  title: "Forms/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: { label: "Stop asking about bun test" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = {
  args: { checked: true, onChange: () => {} },
};

export const Indeterminate: Story = {
  args: { indeterminate: true, label: "All tools", onChange: () => {} },
};

export const WithHint: Story = {
  args: {
    checked: true,
    label: "Stop asking about bun test",
    hint: "Grants for this thread only. Revoke from the sidebar.",
    onChange: () => {},
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    label: "Commit directly to main",
    onChange: () => {},
  },
};

export const Interactive: Story = {
  render: function Render() {
    const [checked, setChecked] = useState(false);
    return (
      <Checkbox
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
        label="Stop asking about bun test"
        hint="Grants for this thread only. Revoke from the sidebar."
      />
    );
  },
};
