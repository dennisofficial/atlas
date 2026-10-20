import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkpoint } from "@dltech/atlas-ui/ai/checkpoint";

const meta = {
  title: "AI/Checkpoint",
  component: Checkpoint,
  args: { label: "Button renamed" },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Checkpoint>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

function RestoreDemo() {
  const [restored, setRestored] = useState(false);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Checkpoint label="Button renamed" onRestore={() => setRestored(true)} />
      <p className="text-muted-foreground">{restored ? "Restored — later turns dropped." : "Press Restore."}</p>
    </div>
  );
}

export const Interactive: Story = { render: () => <RestoreDemo /> };
