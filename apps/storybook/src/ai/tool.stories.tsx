import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiffViewer } from "@dltech/atlas-ui/ai/diff-viewer";
import { EToolKind, EToolState, Tool } from "@dltech/atlas-ui/ai/tool";
import { Trace } from "@dltech/atlas-ui/components/trace";

import { DIFF_LINES, GIT_STATUS_OUTPUT, TYPECHECK_OUTPUT } from "../fixtures/agent";

const meta = {
  title: "AI/Tool",
  component: Tool,
  args: { label: "git status --short", state: EToolState.Done, output: GIT_STATUS_OUTPUT },
  argTypes: {
    state: { control: "select", options: Object.values(EToolState) },
    kind: { control: "select", options: Object.values(EToolKind) },
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tool>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Done: Story = {};

export const Running: Story = {
  args: { label: "bun run typecheck", state: EToolState.Running },
};

export const Failed: Story = {
  args: {
    label: "bun run typecheck",
    state: EToolState.Error,
    errorText: TYPECHECK_OUTPUT,
    elapsed: "4.1s",
  },
};

export const Denied: Story = {
  args: { label: "rm -rf node_modules", state: EToolState.Denied },
};

export const AwaitingApproval: Story = {
  args: { label: "rm -rf node_modules", state: EToolState.AwaitingApproval },
};

export const States: Story = {
  render: () => (
    <Trace>
      <Tool label="git status --short" output={GIT_STATUS_OUTPUT} elapsed="0.2s" />
      <Tool
        label="bun run typecheck"
        state={EToolState.Error}
        errorText={TYPECHECK_OUTPUT}
      />
      <Tool label="rm -rf dist" state={EToolState.Denied} />
      <Tool label="bun test" state={EToolState.Running} />
    </Trace>
  ),
};

export const Kinds: Story = {
  render: () => (
    <Trace>
      <Tool kind={EToolKind.Read} label="packages/ui/src/ai/tool.tsx" output="148 lines" />
      <Tool kind={EToolKind.Search} label="TraceLine" output="12 matches in 9 files" />
      <Tool kind={EToolKind.Edit} label="diff-viewer.tsx" state={EToolState.Running} />
      <Tool kind={EToolKind.Web} label="ui.shadcn.com/docs/ai-elements" output="200 OK" />
      <Tool kind={EToolKind.Skill} label="ui-design" state={EToolState.Done} />
    </Trace>
  ),
};

export const WithDiffOutput: Story = {
  args: { kind: EToolKind.Edit, label: "packages/ui/src/tokens/semantic.ts", defaultOpen: true },
  render: (args) => (
    <Tool {...args} elapsed="0.4s">
      <DiffViewer path="packages/ui/src/tokens/semantic.ts" added={3} removed={2} lines={DIFF_LINES} />
    </Tool>
  ),
};
