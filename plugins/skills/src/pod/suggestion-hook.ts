import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type BeforeTurn, type HookOutcome } from '@dltech/atlas-core'
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

const QUIET: HookOutcome = {}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const suggestionOf = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
}): Promise<HookOutcome> => {
  const input = skillSuggestionStateOf({ events: args.ctx.events() })
  if (input === undefined) return QUIET
  if (!args.ctx.classifier.status().on) return QUIET
  if (args.options.suggests !== undefined && !(await args.options.suggests(args.ctx))) return QUIET
  const catalogue = await catalogueOf({ ctx: args.ctx, options: args.options })
  if (catalogue === null) return QUIET
  const ask = skillSuggestionAskOf({ input, candidates: listingEntriesOf(catalogue) })
  if (ask === undefined) return QUIET
  const outcome = await args.ctx.classifier.classify({
    state: ask.state,
    questions: ask.questions,
    signal: AbortSignal.timeout(SKILL_SUGGEST_DEADLINE_MS),
  })
  if (!outcome.ok) {
    args.ctx.log(`skill suggestion skipped: ${outcome.fault}: ${outcome.detail}`)
    return QUIET
  }
  const suggestion = skillSuggestionOf({ answers: outcome.answers, names: ask.names })
  if (suggestion === undefined) return QUIET
  return {
    drafts: [
      {
        type: 'context-loaded',
        slot: SKILL_SUGGESTION_SLOT,
        key: SKILL_SUGGESTION_KEY,
        content: skillSuggestionBlockOf(suggestion),
        ...(input.trigger === undefined ? {} : { triggeredBy: input.trigger }),
      },
    ],
  }
}

export const skillsSuggestionHook = (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
}): RegisteredHook<BeforeTurn> => ({
  name: 'skills-suggestion',
  order: ORDER,
  awaited: true,
  run: async () =>
    await suggestionOf(args).catch((error: unknown) => {
      args.ctx.log(`skill suggestion skipped: ${messageOf(error)}`)
      return QUIET
    }),
})
