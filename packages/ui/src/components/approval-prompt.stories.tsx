import type { Meta, StoryObj } from "@storybook/react-vite";

import { ApprovalPrompt } from "./approval-prompt";

const meta = {
  title: "Agent/ApprovalPrompt",
  component: ApprovalPrompt,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApprovalPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithGrant: Story = {
  args: {
    reason:
      "bun run deploy would push to the production Caddy host. Nothing in this thread has granted that.",
    dimensions: ["network", "irreversible"],
    evidence: [
      "matched rule: deploy scripts require a human",
      "host caddy.dltech.io is outside the workspace",
    ],
    options: [
      { choice: "proceed", label: "Proceed" },
      {
        choice: "always",
        label: "Proceed, and stop asking about bun run deploy",
      },
      { choice: "decline", label: "Decline" },
    ],
  },
};

export const ProceedDecline: Story = {
  args: {
    reason:
      "rm -rf node_modules would delete 1,214 directories inside the workspace.",
    evidence: ["matched rule: recursive delete requires a human"],
    options: [
      { choice: "proceed", label: "Proceed" },
      { choice: "decline", label: "Decline" },
    ],
  },
};

export const NoHints: Story = {
  args: {
    ...WithGrant.args,
    hints: false,
  },
};
