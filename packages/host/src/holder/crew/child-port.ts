import type { PodCrew, SubagentSaid, SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

const refusal = (message: string): Error => new Error(message)

export const childPortOf = (args: {
  say(said: { agentId: string; text: string }): Promise<SubagentSaid | undefined>
  report(report: { text: string }): Promise<SubagentSnapshot>
}): PodCrew => ({
  spawn: async () => {
    throw refusal('a sub-agent cannot spawn sub-agents')
  },
  say: async (said) => args.say(said),
  stop: async () => {
    throw refusal('a sub-agent cannot stop other agents')
  },
  list: () => [],
  report: async ({ text }) => args.report({ text }),
})
