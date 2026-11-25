export enum EPullRequestGlyph {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
}

export enum EPullRequestTone {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
  Queued = 'queued',
  Unknown = 'unknown',
}

export enum EPullRequestStateWord {
  Open = 'open',
  Draft = 'draft',
  Merged = 'merged',
  Closed = 'closed',
  Queued = 'queued',
  Unknown = 'unknown',
}

export enum EPullRequestChecksState {
  Expected = 'expected',
}

export enum EChecksSummary {
  None = 'none',
  Unknown = 'unknown',
}

export type PullRequestChecksFacts = {
  running?: number | undefined
  passed?: number | undefined
  failed?: number | undefined
  expected?: number | undefined
}

export type PullRequestFacts = {
  state: string | null | undefined
  checks?: PullRequestChecksFacts | null | undefined
  checksState?: string | null | undefined
  mergeable?: boolean | null | undefined
  mergeQueued?: boolean | undefined
  autoMerge?: boolean | undefined
}

export type PullRequestChecksTally = {
  running: number
  passed: number
  failed: number
  expected: number
}

export type PullRequestDisplay = {
  glyph: EPullRequestGlyph
  tone: EPullRequestTone
  stateWord: EPullRequestStateWord
  conflict: boolean
  autoMerge: boolean
  settled: boolean
  checks: PullRequestChecksTally | EChecksSummary
}

export const isChecksTally = (
  checks: PullRequestChecksTally | EChecksSummary,
): checks is PullRequestChecksTally => typeof checks === 'object'

const stateWordOf = (state: string | null | undefined): EPullRequestStateWord => {
  const word = (state ?? '').toLowerCase()
  if (word === EPullRequestStateWord.Merged) return EPullRequestStateWord.Merged
  if (word === EPullRequestStateWord.Closed) return EPullRequestStateWord.Closed
  if (word === EPullRequestStateWord.Draft) return EPullRequestStateWord.Draft
  if (word === EPullRequestStateWord.Open) return EPullRequestStateWord.Open
  return EPullRequestStateWord.Unknown
}

const isSettledWord = (word: EPullRequestStateWord): boolean =>
  word === EPullRequestStateWord.Merged || word === EPullRequestStateWord.Closed

export const pullRequestIsSettled = (facts: PullRequestFacts): boolean =>
  isSettledWord(stateWordOf(facts.state))

export const pullRequestHasConflicts = (facts: PullRequestFacts): boolean => {
  if (facts.mergeable !== false) return false
  const word = stateWordOf(facts.state)
  return word === EPullRequestStateWord.Open || word === EPullRequestStateWord.Draft
}

export const pullRequestChecksTallyOf = (
  facts: PullRequestFacts,
): PullRequestChecksTally | undefined => {
  const running = facts.checks?.running ?? 0
  const passed = facts.checks?.passed ?? 0
  const failed = facts.checks?.failed ?? 0
  const expected =
    facts.checks?.expected ?? (facts.checksState === EPullRequestChecksState.Expected ? 1 : 0)
  if (running + passed + failed + expected === 0) return undefined
  return { running, passed, failed, expected }
}

const glyphOf = (word: EPullRequestStateWord): EPullRequestGlyph => {
  if (word === EPullRequestStateWord.Merged) return EPullRequestGlyph.Merged
  if (word === EPullRequestStateWord.Closed) return EPullRequestGlyph.Closed
  if (word === EPullRequestStateWord.Draft) return EPullRequestGlyph.Draft
  return EPullRequestGlyph.Open
}

const toneOf = ({
  word,
  queued,
}: {
  word: EPullRequestStateWord
  queued: boolean
}): EPullRequestTone => {
  if (queued) return EPullRequestTone.Queued
  if (word === EPullRequestStateWord.Merged) return EPullRequestTone.Merged
  if (word === EPullRequestStateWord.Closed) return EPullRequestTone.Closed
  if (word === EPullRequestStateWord.Draft) return EPullRequestTone.Draft
  if (word === EPullRequestStateWord.Open) return EPullRequestTone.Open
  return EPullRequestTone.Unknown
}

export const pullRequestDisplayOf = (facts: PullRequestFacts): PullRequestDisplay => {
  const word = stateWordOf(facts.state)
  const settled = isSettledWord(word)
  const queued = facts.mergeQueued === true && !settled
  const complete =
    facts.checks?.running !== undefined &&
    facts.checks.passed !== undefined &&
    facts.checks.failed !== undefined
  const tally = pullRequestChecksTallyOf(facts)
  return {
    glyph: glyphOf(word),
    tone: toneOf({ word, queued }),
    stateWord: queued ? EPullRequestStateWord.Queued : word,
    conflict: pullRequestHasConflicts(facts),
    // GitHub queues an auto-merge pull request once it is green, so the queue hides the
    // marker that put it there.
    autoMerge: facts.autoMerge === true && !settled && !queued,
    settled,
    checks: complete ? (tally ?? EChecksSummary.None) : EChecksSummary.Unknown,
  }
}
