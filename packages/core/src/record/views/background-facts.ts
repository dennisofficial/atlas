import { shellKey } from '../../shells/lifecycle'
import type { V2Event } from '../event'

export type BackgroundFacts = {
  shells: readonly string[]
  agents: readonly string[]
}

export const NO_BACKGROUND: BackgroundFacts = { shells: [], agents: [] }

const withKey = (keys: readonly string[], key: string): readonly string[] =>
  keys.includes(key) ? keys : [...keys, key]

const withoutKey = (keys: readonly string[], key: string): readonly string[] =>
  keys.includes(key) ? keys.filter((kept) => kept !== key) : keys

export const stepBackground = (facts: BackgroundFacts, event: V2Event): BackgroundFacts => {
  switch (event.type) {
    case 'background-shell-started':
      return { ...facts, shells: withKey(facts.shells, shellKey(event)) }
    case 'background-shell-ended':
      return { ...facts, shells: withoutKey(facts.shells, shellKey(event)) }
    case 'agent-spawned':
    case 'agent-restarted':
      return { ...facts, agents: withKey(facts.agents, event.agentId) }
    case 'agent-ended':
      return { ...facts, agents: withoutKey(facts.agents, event.agentId) }
    default:
      return facts
  }
}

export const hasBackground = (facts: BackgroundFacts): boolean =>
  facts.shells.length > 0 || facts.agents.length > 0
