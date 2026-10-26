import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { EToolKind, EToolState, type ToolProps } from '@dltech/atlas-ui/ai/tool'

import type { AgentRun } from './agent-run'
import { ESessionState } from './session-types'

export const IMPORTS_ID = 'sa-imports'
export const DOCS_ID = 'sa-docs'
export const FOCUS_ID = 'sa-focus'
export const STORIES_ID = 'sa-stories'

export const FOCUS_CALL_COUNT = 214

export const REPORT_GROUPS: string[][] = [
  [IMPORTS_ID, DOCS_ID],
  [FOCUS_ID, STORIES_ID],
]

const FOCUS_FILES = [
  'button',
  'input',
  'select',
  'tabs',
  'dialog',
  'sheet',
  'popover',
  'tooltip',
  'checkbox',
  'switch',
  'slider',
  'toggle',
]

function focusCall(index: number): ToolProps {
  const file = FOCUS_FILES[Math.floor(index / 3) % FOCUS_FILES.length] ?? 'button'
  const path = `packages/ui/src/components/${file}.tsx`
  if (index % 3 === 0) return { kind: EToolKind.Read, label: path, output: `${60 + index} lines` }
  if (index % 3 === 1) {
    return {
      kind: EToolKind.Search,
      label: `focus-visible in ${file}.tsx`,
      output: `${(index % 4) + 1} matches`,
      elapsed: '0.2s',
    }
  }
  return {
    kind: EToolKind.Shell,
    label: `rg -n "outline-none" ${path}`,
    output: `${path}:${20 + (index % 40)}`,
    elapsed: '0.1s',
  }
}

function focusCalls(running: boolean): ToolProps[] {
  return Array.from({ length: FOCUS_CALL_COUNT }, (_, index) => {
    const call = focusCall(index)
    if (running && index === FOCUS_CALL_COUNT - 1) {
      return { kind: call.kind, label: call.label, state: EToolState.Running }
    }
    return call
  })
}

const IMPORTS: AgentRun = {
  id: IMPORTS_ID,
  agentType: 'explore',
  intent: 'Find legacy home importers',
  display: EAgentDisplay.Done,
  elapsed: '1m 48s',
  model: 'claude-sonnet',
  context: { tokens: 54_200, window: 200_000 },
  endedAt: 3,
  brief:
    'Find everything that still imports the legacy home page or links to it, across apps/web and apps/storybook. Report file and line. Do not edit any file.',
  calls: [
    {
      kind: EToolKind.Search,
      label: 'LegacyHome in apps',
      output: '6 matches in 3 files',
      elapsed: '0.4s',
    },
    { kind: EToolKind.Read, label: 'apps/web/src/app/page.tsx', output: '41 lines' },
    {
      kind: EToolKind.Read,
      label: 'apps/storybook/src/app/home/home.stories.tsx',
      output: '58 lines',
    },
    {
      kind: EToolKind.Search,
      label: '/legacy-home in apps',
      output: '2 matches in 2 files',
      elapsed: '0.3s',
    },
  ],
  report: [
    'Only three places still reference the legacy home page.',
    '- `apps/web/src/app/page.tsx` renders it as the root route.',
    '- `apps/storybook/src/app/home/home.stories.tsx` has two stories for it.',
    '- `apps/web/src/features/shell/app-shell.tsx:42` links to `/legacy-home` from the logo.',
    'Nothing else imports it, so removing those three is enough.',
  ].join('\n'),
}

const DOCS: AgentRun = {
  id: DOCS_ID,
  agentType: 'general-purpose',
  intent: 'Check the shadcn migration guide',
  display: EAgentDisplay.Failed,
  elapsed: '48s',
  model: 'claude-haiku',
  context: { tokens: 7_000, window: 200_000 },
  endedAt: 2,
  brief:
    'Read the shadcn base-nova migration guide and list any renamed CSS variables we have not mapped yet. Use the public docs only.',
  calls: [
    {
      kind: EToolKind.Web,
      label: 'ui.shadcn.com/docs/changelog',
      output: '200 OK',
      elapsed: '1.2s',
    },
    { kind: EToolKind.Web, label: 'ui.shadcn.com/docs/theming', output: '200 OK', elapsed: '0.9s' },
    {
      kind: EToolKind.Web,
      label: 'ui.shadcn.com/docs/migration/base-nova',
      state: EToolState.Error,
      errorText: 'web_fetch timed out after 30s',
      elapsed: '30s',
    },
  ],
  errorText: 'web_fetch timed out after 30s',
}

const FOCUS: AgentRun = {
  id: FOCUS_ID,
  agentType: 'reviewer',
  intent: 'Audit focus rings in ui',
  display: EAgentDisplay.Running,
  elapsed: '6m 40s',
  model: 'claude-sonnet',
  context: { tokens: 138_400, window: 200_000 },
  brief:
    'Check every interactive component in packages/ui for a visible keyboard focus ring and list the gaps, ordered by how often the component is used. Do not edit any file.',
  calls: focusCalls(true),
}

const STORIES: AgentRun = {
  id: STORIES_ID,
  agentType: 'explore',
  intent: 'List stories using the old Tool props',
  display: EAgentDisplay.Running,
  elapsed: '1m 52s',
  model: 'claude-sonnet',
  context: { tokens: 31_600, window: 200_000 },
  brief: 'List every story that passes the removed `status` prop to Tool or ToolLine.',
  calls: [
    {
      kind: EToolKind.Search,
      label: 'status= in packages/ui/src/ai',
      output: '9 matches',
      elapsed: '0.3s',
    },
    { kind: EToolKind.Read, label: 'packages/ui/src/ai/tool.stories.tsx', output: '112 lines' },
    { kind: EToolKind.Search, label: 'ToolLine in apps/storybook', state: EToolState.Running },
  ],
}

const FOCUS_DONE: AgentRun = {
  ...FOCUS,
  display: EAgentDisplay.Done,
  elapsed: '9m 12s',
  endedAt: 12,
  calls: focusCalls(false),
  report: [
    'Four components have no visible keyboard focus ring.',
    '- `toggle` and `slider` rely on the browser outline, which the reset removes.',
    '- `tabs` triggers show a ring only on the line variant.',
    '- `switch` has a ring but at 20% opacity, below contrast.',
    'The other eight pass.',
  ].join('\n'),
}

const STORIES_DONE: AgentRun = {
  ...STORIES,
  display: EAgentDisplay.Done,
  elapsed: '3m 02s',
  endedAt: 9,
  calls: STORIES.calls.map((call) => ({ ...call, state: EToolState.Done })),
  report: 'No story passes the removed `status` prop. The nine matches are unrelated step props.',
}

const LIVE: AgentRun[] = [IMPORTS, DOCS, FOCUS, STORIES]
const SETTLED: AgentRun[] = [IMPORTS, DOCS, FOCUS_DONE, STORIES_DONE]

export function agentsFor(state: ESessionState): AgentRun[] {
  return state === ESessionState.Idle ? SETTLED : LIVE
}
