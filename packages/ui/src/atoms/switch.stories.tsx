import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Switch } from "./switch";

const meta = {
  title: "Forms/Switch",
  component: Switch,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md"] },
  },
  args: { label: "Side-by-side diffs", onChange: () => {} },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = {
  args: { checked: true },
};

export const WithHint: Story = {
  args: {
    checked: true,
    label: "Side-by-side diffs",
    hint: "Falls back to inline under 140 columns.",
  },
};

export const Small: Story = {
  args: { size: "sm", label: "Auto-restart on crash" },
};

export const Disabled: Story = {
  args: { disabled: true, checked: true },
};

export const Interactive: Story = {
  render: function Render() {
    const [checked, setChecked] = useState(true);
    return (
      <Switch
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
        label="Side-by-side diffs"
        hint="Falls back to inline under 140 columns."
      />
    );
  },
};
