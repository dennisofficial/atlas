import {
  BeforeTurnHook,
  EStage,
  skillSuggestionBlock,
  type BeforeTurn,
  type DecisionPort,
  type Event,
  type EventLogPort,
  type EventOfType,
  type HookOrder,
  type SkillSuggestionCandidate,
  type ThreadId,
} from '@dltech/atlas-core'

import { suggestSkill } from '../skills/suggest'
import type { SkillRegistryPort } from '../skills/port'
import type { DiscoveredSkill } from '../skills/skill'

const candidateOf = (skill: DiscoveredSkill): SkillSuggestionCandidate => ({
  name: skill.spec.name,
  description: skill.frontmatter.description,
  whenToUse: skill.frontmatter.whenToUse,
  body: skill.body,
})

const latestSaid = (events: readonly Event[]): EventOfType<'user-said'> | undefined =>
  events.findLast((event): event is EventOfType<'user-said'> => event.type === 'user-said')

export class SkillSuggestionHook extends BeforeTurnHook {
  readonly name = 'skill-suggestion'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 10 }

  private readonly log: EventLogPort | undefined
  private readonly skills: SkillRegistryPort | undefined
  private readonly decisions: DecisionPort
  private readonly enabled: () => boolean
  private readonly suggested = new Map<string, string>()

  constructor(args: {
    log?: EventLogPort | undefined
    skills?: SkillRegistryPort | undefined
    decisions: DecisionPort
    enabled: () => boolean
  }) {
    super()
    this.log = args.log
    this.skills = args.skills
    this.decisions = args.decisions
    this.enabled = args.enabled
  }

  readonly run: BeforeTurn = async ({ threadId }) => {
    if (!this.enabled()) return {}
    if (this.log === undefined || this.skills === undefined) return {}

    const said = latestSaid(await this.log.readOwn({ threadId }))
    if (said === undefined) return {}

    const request = said.text.trim()
    if (request === '') return {}
    if (this.suggested.get(threadId) === said.id) return {}

    const candidates = this.skills.all().filter((skill) => skill.modelInvocable).map(candidateOf)
    if (candidates.length === 0) return {}

    const suggestion = await suggestSkill({
      decisions: this.decisions,
      candidates,
      request,
      signal: new AbortController().signal,
    })
    if (!suggestion.ok) return {}

    this.suggested.set(threadId, said.id)
    return { additionalContext: skillSuggestionBlock({ name: suggestion.name }) }
  }
}
