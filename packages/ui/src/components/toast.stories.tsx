import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Toast, ToastStack } from "./toast";

const meta = {
  title: "Overlays/Toast",
  component: Toast,
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "success", "warning", "destructive"],
    },
  },
  args: {
    tone: "neutral",
    title: "Rewound to turn 4",
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Success: Story = {
  args: { tone: "success", title: "All 212 tests pass" },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    title: "Context is 92% full",
    body: "The next turn may drop the oldest tool results.",
  },
};

export const Destructive: Story = {
  args: {
    tone: "destructive",
    title: "Turn failed: model refused the tool schema",
    body: "The harness kept the transcript. Retry sends the same context.",
    action: (
      <Button variant="link" size="xs">
        Retry
      </Button>
    ),
  },
};

export const Stack: Story = {
  render: () => (
    <ToastStack>
      <Toast tone="success" title="Rewound to turn 4" />
      <Toast
        tone="warning"
        title="Context is 92% full"
        body="The next turn may drop the oldest tool results."
      />
      <Toast
        tone="destructive"
        title="Turn failed: model refused the tool schema"
        body="The harness kept the transcript. Retry sends the same context."
        action={
          <Button variant="link" size="xs">
            Retry
          </Button>
        }
        onDismiss={() => {}}
      />
    </ToastStack>
  ),
};
