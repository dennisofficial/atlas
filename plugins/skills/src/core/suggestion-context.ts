import {
  EContextSlot,
  EMessageOrigin,
  pendingInputsOf,
  pendingMessagesOf,
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

export type SkillSuggestionState = SkillSuggestionInput & { trigger: string | undefined }

export const SKILL_SUGGEST_TURNS = 3
export const SKILL_SUGGEST_OPERATOR_CHARS = 1_200
export const SKILL_SUGGEST_AGENT_CHARS = 800

export const SKILL_SUGGESTION_SLOT = 'skill-suggestion'
export const SKILL_SUGGESTION_KEY = 'latest'

type OperatorSaid = Extract<V2Event, { type: 'user-said' }>
type AgentSaid = Extract<V2Event, { type: 'assistant-said' }>

type OpenTurn = { operator: string; agent: string | undefined; trigger: string | undefined }

type Reading = {
  turns: OpenTurn[]
  loaded: Set<string>
  triggers: Set<string>
  answered: boolean
  suggested: boolean
}

export const skillSuggestionTriggerOf = (inboxId: number): string => `inbox:${inboxId}`

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
    reading.turns.push({
      operator: event.text,
      agent: undefined,
      trigger: event.inboxId === undefined ? undefined : skillSuggestionTriggerOf(event.inboxId),
    })
    reading.answered = false
    reading.suggested = false
    return reading
  }
  if (event.type === 'context-loaded' && event.slot === SKILL_SUGGESTION_SLOT) {
    reading.suggested = true
    if (event.triggeredBy !== undefined) reading.triggers.add(event.triggeredBy)
    return reading
  }
  if (event.type !== 'assistant-said') return reading
  reading.answered = true
  const latest = reading.turns.at(-1)
  const text = replyTextOf(event)
  if (latest !== undefined && text !== '') latest.agent = text
  return reading
}

const withPending = (args: { reading: Reading; visible: readonly V2Event[] }): Reading => {
  const pending = pendingMessagesOf(pendingInputsOf(args.visible)).filter(
    (entry) =>
      entry.message !== undefined &&
      (entry.message.via ?? EMessageOrigin.Operator) === EMessageOrigin.Operator,
  )
  if (pending.length === 0) return args.reading
  for (const entry of pending) {
    args.reading.turns.push({
      operator: entry.message?.text ?? '',
      agent: undefined,
      trigger: skillSuggestionTriggerOf(entry.inboxId),
    })
  }
  return { ...args.reading, answered: false, suggested: false }
}

export const skillSuggestionStateOf = (args: {
  events: readonly V2Event[]
}): SkillSuggestionState | undefined => {
  const visible = visibleEvents(args.events)
  const read = visible.reduce(stepReading, {
    turns: [],
    loaded: new Set<string>(),
    triggers: new Set<string>(),
    answered: false,
    suggested: false,
  })
  const reading = withPending({ reading: read, visible })
  const latest = reading.turns.at(-1)
  if (latest === undefined || reading.answered || reading.suggested) return undefined
  if (latest.trigger !== undefined && reading.triggers.has(latest.trigger)) return undefined
  return {
    turns: reading.turns.slice(-SKILL_SUGGEST_TURNS).map((turn) => ({
      operator: clipped({ text: turn.operator, maximum: SKILL_SUGGEST_OPERATOR_CHARS }),
      agent:
        turn.agent === undefined
          ? undefined
          : clipped({ text: turn.agent, maximum: SKILL_SUGGEST_AGENT_CHARS }),
    })),
    loaded: [...reading.loaded],
    trigger: latest.trigger,
  }
}
