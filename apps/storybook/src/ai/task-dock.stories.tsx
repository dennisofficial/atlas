import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EStepStatus, type PlanStep } from "@dltech/atlas-ui/ai/plan";
import { PromptInput } from "@dltech/atlas-ui/ai/prompt-input";
import { TaskDock, type QueuedMessage, type TaskDockProps } from "@dltech/atlas-ui/ai/task-dock";

const STEPS: PlanStep[] = [
  { id: "1", title: "Read the vendored sidebar", status: EStepStatus.Done },
  { id: "2", title: "Map thread groups onto SidebarGroup", status: EStepStatus.Done },
  { id: "3", title: "Wire the account menu", status: EStepStatus.Done },
  { id: "4", title: "Running typecheck", status: EStepStatus.Running },
  { id: "5", title: "Screenshot dark and light", status: EStepStatus.Pending },
  { id: "6", title: "Fix contrast findings", status: EStepStatus.Pending },
  { id: "7", title: "Open the pull request", status: EStepStatus.Pending },
];

const QUEUED: QueuedMessage[] = [
  { id: "q1", text: "Also rename the Inactive bucket to Idle for 72h" },
  { id: "q2", text: "After that, add the keyboard shortcut hints to the account menu so they match the keymap page" },
];

const meta = {
  title: "AI/Task Dock",
  component: TaskDock,
  args: { steps: STEPS },
  decorators: [
    (Story) => (
      <div className="flex min-h-[28rem] w-[44rem] max-w-full flex-col justify-end gap-2">
        <Story />
        <PromptInput placeholder="Message Atlas…" onSubmit={() => undefined} />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskDock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Expanded: Story = { args: { defaultOpen: true } };

export const WithQueue: Story = { args: { queued: QUEUED } };

export const ExpandedWithQueue: Story = { args: { queued: QUEUED, defaultOpen: true } };

export const AllDone: Story = {
  args: { steps: STEPS.map((step) => ({ ...step, status: EStepStatus.Done })) },
};

export const Failed: Story = {
  args: {
    steps: STEPS.map((step) =>
      step.id === "4" ? { ...step, title: "bun run typecheck", status: EStepStatus.Error } : step,
    ),
  },
};

function InteractiveDock(args: TaskDockProps) {
  const [queued, setQueued] = useState(QUEUED);
  const handleRemove = (id: string) =>
    setQueued((current) => current.filter((message) => message.id !== id));
  return <TaskDock {...args} queued={queued} onRemoveQueued={handleRemove} defaultOpen />;
}

export const Interactive: Story = {
  render: (args) => <InteractiveDock {...args} />,
};
