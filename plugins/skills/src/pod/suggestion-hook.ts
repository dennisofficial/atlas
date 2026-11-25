import type { RegisteredHook } from '@dltech/atlas-agent'
import {
  contextBlock,
  EStage,
  type Assembled,
  type BeforeStep,
  type EventDraft,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import {
  SKILL_SUGGEST_DEADLINE_MS,
  SKILL_SUGGESTION_KEY,
  SKILL_SUGGESTION_SLOT,
  skillSuggestionAskOf,
  skillSuggestionBlockOf,
  skillSuggestionOf,
  skillSuggestionStateOf,
} from '../core'
import { catalogueOf } from './catalogue-source'
import { listingEntriesOf } from './listing'
import type { SkillsPodOptions } from './resources'

const ORDER = { stage: EStage.Observe, nudge: 10 }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const suggestionOf = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
}): Promise<EventDraft | undefined> => {
  const input = skillSuggestionStateOf({ events: args.ctx.events() })
  if (input === undefined) return undefined
  if (!args.ctx.classifier.status().on) return undefined
  if (args.options.suggests !== undefined && !(await args.options.suggests(args.ctx)))
    return undefined
  const catalogue = await catalogueOf({ ctx: args.ctx, options: args.options })
  if (catalogue === null) return undefined
  const ask = skillSuggestionAskOf({ input, candidates: listingEntriesOf(catalogue) })
  if (ask === undefined) return undefined
  const outcome = await args.ctx.classifier.classify({
    state: ask.state,
    questions: ask.questions,
    signal: AbortSignal.timeout(SKILL_SUGGEST_DEADLINE_MS),
  })
  if (!outcome.ok) {
    args.ctx.log(`skill suggestion skipped: ${outcome.fault}: ${outcome.detail}`)
    return undefined
  }
  const suggestion = skillSuggestionOf({ answers: outcome.answers, names: ask.names })
  if (suggestion === undefined) return undefined
  return {
    type: 'context-loaded',
    slot: SKILL_SUGGESTION_SLOT,
    key: SKILL_SUGGESTION_KEY,
    content: skillSuggestionBlockOf(suggestion),
    ...(input.trigger === undefined ? {} : { triggeredBy: input.trigger }),
  }
}

type Recorded = Extract<RecordEvent, { type: 'context-loaded' }>

const recordedOf = (args: {
  events: readonly RecordEvent[]
  content: string
}): Recorded | undefined =>
  args.events.findLast(
    (event): event is Recorded =>
      event.type === 'context-loaded' &&
      event.slot === SKILL_SUGGESTION_SLOT &&
      event.content === args.content,
  )

const withSuggestion = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  assembled: Assembled
}): Promise<Assembled> => {
  const draft = await suggestionOf(args)
  if (draft === undefined || draft.type !== 'context-loaded') return args.assembled
  await args.ctx.append([draft])
  const recorded = recordedOf({ events: args.ctx.events(), content: draft.content })
  if (recorded === undefined) return args.assembled
  const text = contextBlock({ slot: draft.slot, key: draft.key, content: draft.content })
  return {
    ...args.assembled,
    messages: [
      ...args.assembled.messages,
      {
        message: { role: 'user', content: [{ type: 'text', text }] },
        origin: { eventId: recorded.id, seq: recorded.seq },
      },
    ],
  }
}

export const skillsSuggestionHook = (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
}): RegisteredHook<BeforeStep> => ({
  name: 'skills-suggestion',
  order: ORDER,
  awaited: true,
  run: async ({ assembled }) =>
    await withSuggestion({ ...args, assembled }).catch((error: unknown) => {
      args.ctx.log(`skill suggestion skipped: ${messageOf(error)}`)
      return assembled
    }),
})
