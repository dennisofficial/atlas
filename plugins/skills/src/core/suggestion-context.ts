import {
  EContextSlot,
  EMessageOrigin,
  saidBy,
  visibleEvents,
  type V2Event,
} from '@dltech/atlas-core'

export type SkillSuggestionTurn = {
  operator: string
  agent: string | undefined
}

export type SkillSuggestionInput = {
  turns: readonly SkillSuggestionTurn[]
  loaded: readonly string[]
}

export const SKILL_SUGGEST_TURNS = 3
export const SKILL_SUGGEST_OPERATOR_CHARS = 1_200
export const SKILL_SUGGEST_AGENT_CHARS = 800

export const SKILL_SUGGESTION_SLOT = 'skill-suggestion'
export const SKILL_SUGGESTION_KEY = 'latest'

type OperatorSaid = Extract<V2Event, { type: 'user-said' }>
type AgentSaid = Extract<V2Event, { type: 'assistant-said' }>

type OpenTurn = { operator: string; agent: string | undefined }

type Reading = {
  turns: OpenTurn[]
  loaded: Set<string>
  answered: boolean
  suggested: boolean
}

const ELLIPSIS = '…'

const clipped = (args: { text: string; maximum: number }): string => {
  const text = args.text.trim()
  if (text.length <= args.maximum) return text
  return `${text.slice(0, args.maximum - 1).trimEnd()}${ELLIPSIS}`
}

const isOperatorSaid = (event: V2Event): event is OperatorSaid =>
  event.type === 'user-said' && saidBy(event) === EMessageOrigin.Operator

const replyTextOf = (event: AgentSaid): string =>
  event.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()

const loadedNameOf = (event: V2Event): string | undefined => {
  if (event.type === 'context-loaded' && event.slot === EContextSlot.Skill) return event.key
  if (event.type !== 'tool-called' || event.name !== 'skill') return undefined
  const input = event.input
  if (typeof input !== 'object' || input === null || !('name' in input)) return undefined
  return typeof input.name === 'string' ? input.name : undefined
}

const stepReading = (reading: Reading, event: V2Event): Reading => {
  const loaded = loadedNameOf(event)?.trim().toLowerCase()
  if (loaded !== undefined && loaded !== '') reading.loaded.add(loaded)
  if (isOperatorSaid(event)) {
    reading.turns.push({ operator: event.text, agent: undefined })
    reading.answered = false
    reading.suggested = false
    return reading
  }
  if (event.type === 'context-loaded' && event.slot === SKILL_SUGGESTION_SLOT) {
    reading.suggested = true
    return reading
  }
  if (event.type !== 'assistant-said') return reading
  reading.answered = true
  const latest = reading.turns.at(-1)
  const text = replyTextOf(event)
  if (latest !== undefined && text !== '') latest.agent = text
  return reading
}

export const skillSuggestionStateOf = (args: {
  events: readonly V2Event[]
}): SkillSuggestionInput | undefined => {
  const reading = visibleEvents(args.events).reduce(stepReading, {
    turns: [],
    loaded: new Set<string>(),
    answered: false,
    suggested: false,
  })
  if (reading.turns.length === 0 || reading.answered || reading.suggested) return undefined
  return {
    turns: reading.turns.slice(-SKILL_SUGGEST_TURNS).map((turn) => ({
      operator: clipped({ text: turn.operator, maximum: SKILL_SUGGEST_OPERATOR_CHARS }),
      agent:
        turn.agent === undefined
          ? undefined
          : clipped({ text: turn.agent, maximum: SKILL_SUGGEST_AGENT_CHARS }),
    })),
    loaded: [...reading.loaded],
  }
}
