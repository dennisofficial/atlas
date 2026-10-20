import type { Meta, StoryObj } from "@storybook/react-vite";

import { Terminal } from "@dltech/atlas-ui/ai/terminal";

import { BUN_TEST_OUTPUT, TYPECHECK_OUTPUT } from "../fixtures/agent";

const meta = {
  title: "AI/Terminal",
  component: Terminal,
  args: { command: "bun test", output: BUN_TEST_OUTPUT, exitCode: 0, elapsed: "0.2s" },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Terminal>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Succeeded: Story = { args: { defaultOpen: true } };

export const Failed: Story = {
  args: { command: "bun run typecheck", output: TYPECHECK_OUTPUT, exitCode: 1, defaultOpen: true },
};

export const RunningWithOutput: Story = {
  args: { running: true, exitCode: undefined, elapsed: undefined, output: BUN_TEST_OUTPUT.split("\n").slice(0, 6).join("\n") },
};

export const RunningNoOutput: Story = {
  args: { running: true, exitCode: undefined, elapsed: undefined, output: "" },
};
