import type { Meta, StoryObj } from '@storybook/react'

import { DiffViewer } from './diff-viewer'
import { McpServerMark } from './mcp-server-mark'
import { EToolKind, EToolState, Tool } from './tool'
import { Trace } from '#components/trace'

import { DIFF_LINES, GIT_STATUS_OUTPUT, TYPECHECK_OUTPUT } from '../fixtures/agent'

const meta = {
  title: 'AI/Tool',
  component: Tool,
  args: { label: 'git status --short', state: EToolState.Done, output: GIT_STATUS_OUTPUT },
  argTypes: {
    state: { control: 'select', options: Object.values(EToolState) },
    kind: { control: 'select', options: Object.values(EToolKind) },
  },
  decorators: [
    (Story) => (
      <div className="w-[34rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tool>

export default meta

type Story = StoryObj<typeof meta>

export const Done: Story = {}

export const Running: Story = {
  args: { label: 'bun run typecheck', state: EToolState.Running },
}

export const Failed: Story = {
  args: {
    label: 'bun run typecheck',
    state: EToolState.Error,
    errorText: TYPECHECK_OUTPUT,
    elapsed: '4.1s',
  },
}

export const Denied: Story = {
  args: { label: 'rm -rf node_modules', state: EToolState.Denied },
}

export const AwaitingApproval: Story = {
  args: { label: 'rm -rf node_modules', state: EToolState.AwaitingApproval },
}

export const States: Story = {
  render: () => (
    <Trace>
      <Tool label="git status --short" output={GIT_STATUS_OUTPUT} elapsed="0.2s" />
      <Tool label="bun run typecheck" state={EToolState.Error} errorText={TYPECHECK_OUTPUT} />
      <Tool label="rm -rf dist" state={EToolState.Denied} />
      <Tool label="bun test" state={EToolState.Running} />
    </Trace>
  ),
}

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
}

export const TitleOverride: Story = {
  args: { label: 'agent_spawn', title: 'Spawned vault audit' },
}

/** The server in the foreground, the tool in the trace's own muted colour — red when it failed. */
const mcpTitle = (server: string, tool: string, failed = false) => (
  <>
    <span className={failed ? 'text-destructive' : 'text-foreground'}>{server}</span>{' '}
    <span>{tool}</span>
  </>
)

export const Mcp: Story = {
  render: () => (
    <Trace>
      <Tool
        icon={<McpServerMark server="paper" />}
        label="mcp__paper__get_guide"
        title={mcpTitle('Paper', 'Get guide')}
        elapsed="3s"
        output={'Getting started\n\n  bun create paper@latest'}
      />
      <Tool
        icon={<McpServerMark server="wispr-flow" />}
        label="mcp__wispr-flow__search_meetings"
        title={mcpTitle('Wispr Flow', 'Search meetings')}
        elapsed="1.2s"
        output={'3 meetings matched'}
      />
      <Tool
        icon={<McpServerMark server="paper" />}
        label="mcp__paper__get_guide"
        state={EToolState.Error}
        title={mcpTitle('Paper', 'Get guide', true)}
        errorText="MCP server paper is not reachable: connect timed out after 10s"
        elapsed="10s"
      />
      <Tool
        icon={<McpServerMark server="posthog" />}
        label="mcp__posthog__exec"
        state={EToolState.Running}
        title={mcpTitle('Posthog', 'Exec')}
      />
    </Trace>
  ),
}

export const WithDiffOutput: Story = {
  args: { kind: EToolKind.Edit, label: 'packages/ui/src/tokens/semantic.ts', defaultOpen: true },
  render: (args) => (
    <Tool {...args} elapsed="0.4s">
      <DiffViewer
        path="packages/ui/src/tokens/semantic.ts"
        added={3}
        removed={2}
        lines={DIFF_LINES}
      />
    </Tool>
  ),
}
