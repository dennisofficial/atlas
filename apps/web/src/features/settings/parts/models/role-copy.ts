import { roleKey, type ModelRole } from '@dltech/atlas-core'

import { EBuiltInAgentType } from '../../fixtures/settings-agent'
import { TEAMMATE_TYPE } from '../../data/personal/model-roles'

const agentKey = (agentType: string): string => roleKey({ agentType })

const TITLES: Readonly<Record<string, string>> = {
  main: 'Main agent',
  [agentKey(TEAMMATE_TYPE)]: 'Teammates',
  quick: 'Quick calls',
  compaction: 'Compaction',
  subagents: 'Subagents',
  [agentKey(EBuiltInAgentType.Builder)]: 'builder',
  [agentKey(EBuiltInAgentType.Explore)]: 'explore',
  [agentKey(EBuiltInAgentType.GeneralPurpose)]: 'general-purpose',
  [agentKey(EBuiltInAgentType.Preview)]: 'preview',
  [agentKey(EBuiltInAgentType.Reviewer)]: 'reviewer',
}

const TIPS: Readonly<Record<string, string>> = {
  main: 'Plans the work, edits code, and talks to you in the thread. Everything below follows it unless given its own model.',
  [agentKey(TEAMMATE_TYPE)]:
    'Full Atlas sessions running beside the main agent as peers. Applies to new teammates.',
  quick: 'Background calls: session titles, tl;dr footers and the nudge judge.',
  compaction:
    'Summarises older turns when the context fills, for both auto and /compact. The summary is all the next turn sees.',
  subagents:
    'Parallel workers the main agent spawns for search, review, and builds. The default for every sub-agent, which the agent types follow.',
  [agentKey(EBuiltInAgentType.Builder)]:
    'Sub-agents that make a change: a described feature, a located bug, a mechanical edit.',
  [agentKey(EBuiltInAgentType.Explore)]:
    'Search-focused sub-agents that find things in the codebase and report back.',
  [agentKey(EBuiltInAgentType.GeneralPurpose)]:
    'Open-ended sub-agents for research and multi-step tasks.',
  [agentKey(EBuiltInAgentType.Preview)]:
    'Sub-agents that stand up and verify preview servers so the work opens in a browser.',
  [agentKey(EBuiltInAgentType.Reviewer)]:
    'Sub-agents that review code they did not write and report findings.',
}

const copyOf = (table: Readonly<Record<string, string>>, role: ModelRole): string => {
  const value = table[roleKey(role)]
  if (value === undefined) throw new Error(`No copy for ${roleKey(role)}`)
  return value
}

export const roleTitleOf = (role: ModelRole): string => copyOf(TITLES, role)

export const roleTipOf = (role: ModelRole): string => copyOf(TIPS, role)

export const sentenceSubjectOf = (role: ModelRole): string =>
  roleKey(role) === 'main' ? 'The main agent' : roleTitleOf(role)

const SIGN_IN_NAMES: Readonly<Record<string, string>> = { Anthropic: 'Claude', OpenAI: 'Codex' }

export const signInNameOf = (provider: string): string => SIGN_IN_NAMES[provider] ?? provider
