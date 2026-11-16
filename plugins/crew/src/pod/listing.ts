import type { RepoAgentRefusal, RepoAgentType } from '../core'

export const REPO_AGENT_HEADING =
  'Agent types defined in this repository (spawn them with agent_spawn like the built-in types):'

export const repoAgentListingOf = (args: {
  types: readonly RepoAgentType[]
  refusals: readonly RepoAgentRefusal[]
}): string => {
  if (args.types.length === 0 && args.refusals.length === 0) return ''
  return [
    REPO_AGENT_HEADING,
    ...args.types.map((type) => `- ${type.name}: ${type.whenToUse}`),
    ...args.refusals.map(
      (refusal) => `Not loaded: ${refusal.definedIn} — "${refusal.name}" ${refusal.reason}`,
    ),
  ].join('\n')
}
