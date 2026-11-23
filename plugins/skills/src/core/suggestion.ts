import type { ClassifierQuestion, DecisionAnswer } from '@dltech/atlas-core'

import { renderSkillListing, skillSummaryOf, type SkillListingEntry } from './listing'
import type { SkillSuggestionInput } from './suggestion-context'

export const SKILL_SUGGEST_SHORTLIST = 12
export const SKILL_SUGGEST_CANDIDATE_CHARS = 3_000
export const SKILL_SUGGEST_DEADLINE_MS = 1_200

export const SKILL_SUGGEST_GATE_KEY = 'needsProcedure'
export const SKILL_SUGGEST_GATE_THRESHOLD = 0.7
export const SKILL_SUGGEST_FITS_THRESHOLD = 0.75
export const SKILL_SUGGEST_MARGIN = 0.15

const FITS_PREFIX = 'fits:'

const GATE_INSTRUCTIONS =
  'Does this work need a documented procedure or a set of commands that an agent should follow, rather than prose?'

const fitsInstructionsOf = (name: string): string =>
  `Does the procedure in the skill \`${name}\` cover the work above?`

const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'so',
  'that',
  'the',
  'their',
  'then',
  'this',
  'to',
  'up',
  'use',
  'used',
  'using',
  'was',
  'we',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'you',
  'your',
])

const tokensOf = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
  )

const turnsTextOf = (input: SkillSuggestionInput): string =>
  input.turns
    .flatMap((turn) =>
      turn.agent === undefined
        ? [`Operator: ${turn.operator}`]
        : [`Operator: ${turn.operator}`, `Agent: ${turn.agent}`],
    )
    .join('\n\n')

const overlapOf = (args: { entry: SkillListingEntry; words: ReadonlySet<string> }): number => {
  const own = tokensOf(`${args.entry.name} ${skillSummaryOf(args.entry)}`)
  let count = 0
  for (const token of own) if (args.words.has(token)) count += 1
  return count
}

export const skillShortlistOf = (args: {
  input: SkillSuggestionInput
  candidates: readonly SkillListingEntry[]
}): readonly SkillListingEntry[] => {
  const loaded = new Set(args.input.loaded)
  const words = tokensOf(turnsTextOf(args.input))
  return args.candidates
    .filter((entry) => !loaded.has(entry.name.toLowerCase()))
    .map((entry, at) => ({ entry, at, overlap: overlapOf({ entry, words }) }))
    .filter((scored) => scored.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.at - right.at)
    .slice(0, SKILL_SUGGEST_SHORTLIST)
    .map((scored) => scored.entry)
}

export type SkillSuggestionAsk = {
  state: string
  questions: Record<string, ClassifierQuestion>
  names: readonly string[]
}

export const skillSuggestionAskOf = (args: {
  input: SkillSuggestionInput
  candidates: readonly SkillListingEntry[]
  budgetChars?: number
}): SkillSuggestionAsk | undefined => {
  const shortlist = skillShortlistOf({ input: args.input, candidates: args.candidates })
  if (shortlist.length === 0) return undefined
  const listing = renderSkillListing({
    entries: shortlist,
    budgetChars: args.budgetChars ?? SKILL_SUGGEST_CANDIDATE_CHARS,
  }).trim()
  const sections = [
    turnsTextOf(args.input),
    listing === '' ? '' : `Skills the agent can load:\n${listing}`,
  ]
  const names = shortlist.map((entry) => entry.name)
  const questions: Record<string, ClassifierQuestion> = {
    [SKILL_SUGGEST_GATE_KEY]: { type: 'noul', instructions: GATE_INSTRUCTIONS },
  }
  for (const name of names) {
    questions[`${FITS_PREFIX}${name}`] = { type: 'noul', instructions: fitsInstructionsOf(name) }
  }
  return {
    state: sections.filter((section) => section !== '').join('\n\n'),
    questions,
    names,
  }
}

const probabilityOf = (answer: DecisionAnswer | undefined): number | undefined => {
  const value = answer?.noul
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) return undefined
  return value
}

export type SkillSuggestion = { name: string; probability: number }

export const skillSuggestionOf = (args: {
  answers: Readonly<Record<string, DecisionAnswer>>
  names: readonly string[]
}): SkillSuggestion | undefined => {
  const gate = probabilityOf(args.answers[SKILL_SUGGEST_GATE_KEY])
  if (gate === undefined || gate < SKILL_SUGGEST_GATE_THRESHOLD) return undefined
  const scored: SkillSuggestion[] = []
  for (const name of args.names) {
    const probability = probabilityOf(args.answers[`${FITS_PREFIX}${name}`])
    if (probability === undefined) return undefined
    scored.push({ name, probability })
  }
  const [winner, runnerUp] = scored.sort((left, right) => right.probability - left.probability)
  if (winner === undefined || winner.probability < SKILL_SUGGEST_FITS_THRESHOLD) return undefined
  if (runnerUp !== undefined && winner.probability - runnerUp.probability < SKILL_SUGGEST_MARGIN)
    return undefined
  return winner
}

export const skillSuggestionBlockOf = (suggestion: SkillSuggestion): string =>
  `skill: ${suggestion.name} — ${suggestion.probability.toFixed(2)}`
