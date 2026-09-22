import type { DecisionAnswer, DecisionQuestion } from '../ports/decision.port'
import { skillSummaryOf, type SkillListingEntry } from './listing'

export type SkillSuggestionCandidate = SkillListingEntry & { body?: string | undefined }

// Thresholds, gate questions and block wording are the measured values from the TypeSafe
// skill-suggestion cookbook: https://docs.typesafe.ai/cookbooks/skill_suggestion
export const SKILL_SUGGEST_SHORTLIST = 3
export const SKILL_SUGGEST_GATE_THRESHOLD = 0.3
export const SKILL_SUGGEST_FITS_THRESHOLD = 0.3
export const SKILL_SUGGEST_EXCERPT_CHARS = 700
export const SKILL_SUGGEST_MAX_CANDIDATES = 255
export const SKILL_SUGGEST_REQUEST_CHARS = 4000

export const SKILL_SUGGEST_WHICH_KEY = 'which'

const WIDE_INSTRUCTIONS =
  "Which of these skills, if any, is the right one to load to help with the user's latest request?"

const RERANK_INSTRUCTIONS =
  "Exactly one of these skills is the right one to load for the user's latest request. Which one? Read what each actually does, not just its name."

const GATE_KEYS = [
  'acts_on_user_system',
  'would_follow_documented_procedure',
  'prose_suffices',
] as const

type GateKey = (typeof GATE_KEYS)[number]

const INVERTED_GATES: readonly GateKey[] = ['prose_suffices']

const GATE_INSTRUCTIONS: Record<GateKey, string> = {
  acts_on_user_system:
    "Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise?",
  would_follow_documented_procedure:
    'Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding?',
  prose_suffices:
    "Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts?",
}

const gateKey = (key: GateKey): string => `gate::${key}`

const fitsKey = (name: string): string => `fits::${name}`

const summaryOf = (candidate: SkillSuggestionCandidate): string =>
  skillSummaryOf(candidate) || candidate.name

export function skillWideQuestions(args: {
  candidates: readonly SkillSuggestionCandidate[]
}): Record<string, DecisionQuestion> {
  const criteria: Record<string, string> = {}
  for (const candidate of args.candidates.slice(0, SKILL_SUGGEST_MAX_CANDIDATES)) {
    criteria[candidate.name] = summaryOf(candidate)
  }

  const questions: Record<string, DecisionQuestion> = {
    [SKILL_SUGGEST_WHICH_KEY]: { type: 'choice', instructions: WIDE_INSTRUCTIONS, criteria },
  }
  for (const key of GATE_KEYS) {
    questions[gateKey(key)] = { type: 'noul', instructions: GATE_INSTRUCTIONS[key] }
  }
  return questions
}

export function skillRerankQuestions(args: {
  candidates: readonly SkillSuggestionCandidate[]
}): Record<string, DecisionQuestion> {
  const criteria: Record<string, string> = {}
  const questions: Record<string, DecisionQuestion> = {}

  for (const candidate of args.candidates) {
    const summary = summaryOf(candidate)
    const excerpt = candidate.body?.slice(0, SKILL_SUGGEST_EXCERPT_CHARS).trim() ?? ''
    criteria[candidate.name] = excerpt === '' ? summary : `${summary} — ${excerpt}`
    questions[fitsKey(candidate.name)] = {
      type: 'noul',
      instructions: `Does the skill '${candidate.name}' do the specific thing the user's request asks for? It is described as: ${summary}`,
    }
  }

  return {
    [SKILL_SUGGEST_WHICH_KEY]: { type: 'choice', instructions: RERANK_INSTRUCTIONS, criteria },
    ...questions,
  }
}

export function skillGateScore(args: {
  answers: Record<string, DecisionAnswer>
}): number | undefined {
  let total = 0
  for (const key of GATE_KEYS) {
    const noul = args.answers[gateKey(key)]?.noul
    if (noul === undefined) return undefined
    total += INVERTED_GATES.includes(key) ? 1 - noul : noul
  }
  return total / GATE_KEYS.length
}

export function skillShortlist(args: {
  answers: Record<string, DecisionAnswer>
  limit?: number
}): readonly string[] {
  const which = args.answers[SKILL_SUGGEST_WHICH_KEY]
  if (which?.probabilities === undefined) {
    return which?.choice === undefined ? [] : [which.choice]
  }

  const limit = args.limit ?? SKILL_SUGGEST_SHORTLIST
  return Object.entries(which.probabilities)
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit)
    .map(([name]) => name)
}

export function skillRerankWinner(args: {
  answers: Record<string, DecisionAnswer>
  candidates: readonly string[]
  threshold?: number
}): string | undefined {
  const choice = args.answers[SKILL_SUGGEST_WHICH_KEY]?.choice
  if (choice === undefined || !args.candidates.includes(choice)) return undefined

  const threshold = args.threshold ?? SKILL_SUGGEST_FITS_THRESHOLD
  let best = 0
  for (const name of args.candidates) {
    const fits = args.answers[fitsKey(name)]?.noul ?? 0
    if (fits > best) best = fits
  }
  return best < threshold ? undefined : choice
}

export function skillSuggestionBlock(args: { name: string | undefined }): string {
  const body =
    args.name === undefined
      ? 'No skill in the roster appears relevant to this request.'
      : `Relevant to the current request: ${args.name}. Ignore this if it does not fit what the user actually asked for.`
  return `<skill_relevance>\n${body}\n</skill_relevance>`
}
