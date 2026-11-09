import type { EReportKind } from '@dltech/atlas-core'
import type { PodCrew, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

const refusal = (message: string): Error => new Error(message)

export const childPortOf = (args: {
  report(report: { kind: EReportKind; text: string }): Promise<SubagentSnapshot>
}): PodCrew => ({
  spawn: async () => {
    throw refusal('a sub-agent cannot spawn sub-agents')
  },
  say: async () => {
    throw refusal('a sub-agent cannot message other agents')
  },
  stop: async () => {
    throw refusal('a sub-agent cannot stop other agents')
  },
  list: () => [],
  report: async ({ kind, text }) => args.report({ kind, text }),
})
