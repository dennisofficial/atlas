export enum ECiWatch {
  Watching = 'watching',
  Reading = 'reading',
}

export type ECiWatchOf = 'pull-request' | 'workflow-run'

export type CiWatchIntent = { kind: ECiWatch.Reading } | { kind: ECiWatch.Watching; of: ECiWatchOf }

const CHAIN = /&&|\|\||;|\||\n/

const WATCH_FLAG = '--watch'

const PULL_REQUEST_NOUNS: readonly string[] = ['pr']

const RUN_NOUNS: readonly string[] = ['run', 'workflow']

const LOOP_OPENERS: readonly string[] = ['while', 'until', 'for']

const QUOTED = /"[^"]*"|'[^']*'/g

const ACTION_RUNS = /\/actions\/runs/

const tokensOf = (segment: string): readonly string[] =>
  segment.split(/\s+/).filter((token) => token.length > 0)

const wordsOf = (tokens: readonly string[]): readonly string[] =>
  tokens.filter((token) => !token.startsWith('-'))

const ghRestOf = (tokens: readonly string[]): readonly string[] | null => {
  const gh = tokens.indexOf('gh')
  return gh === -1 ? null : tokens.slice(gh + 1)
}

const flavourOf = (words: readonly string[]): ECiWatchOf | null => {
  if (words.some((word) => PULL_REQUEST_NOUNS.includes(word))) return 'pull-request'
  if (words.some((word) => RUN_NOUNS.includes(word))) return 'workflow-run'

  return null
}

const watchesRun = (words: readonly string[]): boolean =>
  words.some((word, index) => word === 'run' && words[index + 1] === 'watch')

const watchWraps = (tokens: readonly string[]): boolean => {
  const watch = tokens.indexOf('watch')
  if (watch === -1) return false

  return tokens.slice(watch + 1).includes('gh')
}

const segmentWatch = (tokens: readonly string[]): ECiWatchOf | null => {
  const rest = ghRestOf(tokens)
  if (rest === null) return null

  const words = wordsOf(rest)
  const flavour = flavourOf(words)
  if (flavour === null) return null

  if (watchWraps(tokens)) return flavour
  if (watchesRun(words)) return 'workflow-run'
  if (rest.includes(WATCH_FLAG)) return flavour
  if (flavour === 'workflow-run' && rest.includes('-w')) return flavour

  return null
}

const readsPullRequest = (tokens: readonly string[]): boolean => {
  const rest = ghRestOf(tokens)
  if (rest === null) return false

  return wordsOf(rest).some((word) => PULL_REQUEST_NOUNS.includes(word))
}

const readsRuns = (tokens: readonly string[]): boolean => {
  const rest = ghRestOf(tokens)
  if (rest === null) return false

  const words = wordsOf(rest)
  if (words.some((word) => RUN_NOUNS.includes(word))) return true

  return rest.some((token) => ACTION_RUNS.test(token))
}

const readsActionsApi = (tokens: readonly string[]): boolean => {
  const rest = ghRestOf(tokens)
  if (rest === null) return false
  if (!rest.includes('api')) return false

  return rest.some((token) => ACTION_RUNS.test(token))
}

const sleeps = (tokens: readonly string[]): boolean => tokens.includes('sleep')

const looped = (links: readonly (readonly string[])[]): boolean =>
  links.some((tokens) => LOOP_OPENERS.includes(tokens[0] ?? ''))

const loopPoll = (links: readonly (readonly string[])[]): ECiWatchOf | null => {
  if (!looped(links) || !links.some(sleeps)) return null
  if (links.some(readsPullRequest)) return 'pull-request'
  if (links.some(readsRuns)) return 'workflow-run'

  return null
}

const apiPoll = (links: readonly (readonly string[])[]): ECiWatchOf | null => {
  const api = links.findIndex(readsActionsApi)
  if (api === -1) return null

  return links.some((tokens, index) => index > api && sleeps(tokens)) ? 'workflow-run' : null
}

export function ciWatchIntent({ command }: { command: string }): CiWatchIntent {
  const links = command.replace(QUOTED, '""').split(CHAIN).map(tokensOf)

  for (const tokens of links) {
    const flavour = segmentWatch(tokens)
    if (flavour !== null) return { kind: ECiWatch.Watching, of: flavour }
  }

  const polled = loopPoll(links) ?? apiPoll(links)
  if (polled !== null) return { kind: ECiWatch.Watching, of: polled }

  return { kind: ECiWatch.Reading }
}
