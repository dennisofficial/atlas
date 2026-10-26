import { EAgentDisplay } from './agent-status'
import type { AgentsPanelAgent, AgentsPanelTeammate } from './agents-panel-types'
import { EToolKind, EToolState, type ToolProps } from './tool'

const CALLS = [
  { label: 'grep -rn cacheKey scripts', output: 'scripts/optimize-images.ts:14' },
  { label: 'scripts/optimize-images.ts', kind: EToolKind.Read, output: 'const cacheKey = sha;' },
]

export const RUNNING_AGENTS: AgentsPanelAgent[] = [
  {
    id: 'a1',
    agentType: 'explore',
    intent: 'Map the image optimization pipeline',
    display: EAgentDisplay.Running,
    elapsed: '4m 12s',
    model: 'claude-sonnet',
    context: { tokens: 87_000, window: 200_000 },
    latestCall: 'Reading scripts/optimize-images.ts',
    brief: 'Find out why image optimization reruns on every deploy.',
    calls: [
      ...CALLS,
      { label: 'sed -n 13,15p scripts/optimize-images.ts', state: EToolState.Running },
    ],
  },
  {
    id: 'a2',
    agentType: 'builder',
    intent: 'Add the cache key to the build script',
    display: EAgentDisplay.NeedsApproval,
    elapsed: '1m 03s',
    model: 'claude-opus',
    context: { tokens: 42_000, window: 200_000 },
    latestCall: 'Waiting to run bun install',
    brief: 'Key the cache on the content hash instead of the commit SHA.',
    calls: [{ label: 'bun install', state: EToolState.AwaitingApproval }],
  },
]

const DONE_COUNT = 7

export const DONE_AGENTS: AgentsPanelAgent[] = Array.from({ length: DONE_COUNT }, (_, index) => ({
  id: `d${index}`,
  agentType: index % 2 === 0 ? 'reviewer' : 'explore',
  intent: `Check module ${index + 1}`,
  display: index === 1 ? EAgentDisplay.Failed : EAgentDisplay.Done,
  elapsed: `${index + 1}m 10s`,
  model: 'claude-sonnet',
  context: { tokens: 31_000 + index * 4_000, window: 200_000 },
  endedAt: 1_000 + index,
  brief: 'Review the module for cache invalidation bugs.',
  calls: CALLS,
  report: index === 1 ? undefined : 'The cache is keyed on the commit SHA, so every deploy misses.',
  errorText: index === 1 ? 'Sandbox lost connection after 9m' : undefined,
}))

export const TEAMMATES: AgentsPanelTeammate[] = [
  { id: 't1', title: 'Migrate the settings page', display: EAgentDisplay.Running },
  { id: 't2', title: 'Port the billing tests', display: EAgentDisplay.NeedsApproval },
  { id: 't3', title: 'Update the docs site', display: EAgentDisplay.Done },
]

interface ToolCallsInput {
  count: number
  running: boolean
}

export function generateToolCalls({ count, running }: ToolCallsInput): ToolProps[] {
  return Array.from({ length: count }, (_, index) => {
    const isLast = index === count - 1
    return {
      label: index % 3 === 0 ? `src/module-${index}.ts` : `grep -rn symbol${index} src`,
      kind: index % 3 === 0 ? EToolKind.Read : EToolKind.Shell,
      state: running && isLast ? EToolState.Running : EToolState.Done,
      output: running && isLast ? undefined : `src/module-${index}.ts:${index + 1}`,
    }
  })
}

const MANY_RUNNING_CALLS = 400
const MANY_DONE_CALLS = 250

export const MANY_CALLS_AGENTS: AgentsPanelAgent[] = [
  {
    id: 'many-running',
    agentType: 'explore',
    intent: 'Audit every call site of the cache helper',
    display: EAgentDisplay.Running,
    elapsed: '22m 40s',
    model: 'claude-sonnet',
    context: { tokens: 164_000, window: 200_000 },
    latestCall: `Reading src/module-${MANY_RUNNING_CALLS - 1}.ts`,
    brief: 'List every caller of the cache helper and note which ones pass a stale key.',
    calls: generateToolCalls({ count: MANY_RUNNING_CALLS, running: true }),
  },
  {
    id: 'many-done',
    agentType: 'reviewer',
    intent: 'Review the migration across all packages',
    display: EAgentDisplay.Done,
    elapsed: '17m 05s',
    model: 'claude-opus',
    context: { tokens: 118_000, window: 200_000 },
    endedAt: 2_000,
    brief: 'Review every package touched by the migration for leftover references.',
    calls: generateToolCalls({ count: MANY_DONE_CALLS, running: false }),
    report: 'No leftover references were found; two packages still import the old helper path.',
  },
]
