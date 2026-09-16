import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Tabs, type TabItem } from "./tabs";

const viewTabs: TabItem[] = [
  { value: "transcript", label: "Transcript" },
  { value: "diff", label: "Diff", count: 14 },
  { value: "shells", label: "Shells", count: 2 },
];

const meta = {
  title: "Navigation/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  argTypes: {
    variant: { control: "select", options: ["underline", "segmented"] },
    size: { control: "select", options: ["sm", "md"] },
  },
  args: { tabs: viewTabs },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Underline: Story = {};

export const Segmented: Story = {
  args: {
    variant: "segmented",
    size: "sm",
    tabs: [
      { value: "inline", label: "Inline" },
      { value: "split", label: "Side by side" },
    ],
  },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const WithDisabled: Story = {
  args: {
    tabs: [
      ...viewTabs,
      { value: "agents", label: "Agents", count: 0, disabled: true },
    ],
  },
};

export const Controlled: Story = {
  render: function ControlledStory(args) {
    const [value, setValue] = useState("diff");
    return <Tabs {...args} value={value} onChange={setValue} />;
  },
};
