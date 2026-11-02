import {
  createSettlePending as createAgentSettlePending,
  type OnToolOutputNotice,
  type SettlePending,
  type ToolOutputNotice,
} from '@dltech/atlas-agent'

export type { OnToolOutputNotice, SettlePending, ToolOutputNotice }

export const createSettlePending = (
  deps: Omit<Parameters<typeof createAgentSettlePending>[0], 'launchDirectory'> & {
    launchDirectory?: string | undefined
  },
): SettlePending =>
  createAgentSettlePending({ ...deps, launchDirectory: deps.launchDirectory ?? process.cwd() })
