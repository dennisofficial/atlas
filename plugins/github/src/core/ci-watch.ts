export enum ECiWatch {
  Watching = 'watching',
  Reading = 'reading',
}

const CHAIN = /&&|\|\||;|\||\n/

const WATCH_FLAG = '--watch'

const GH_NOUNS: readonly string[] = ['pr', 'run', 'workflow']

const LOOP_OPENERS: readonly string[] = ['while', 'until']

const QUOTED = /"[^"]*"|'[^']*'/g

const tokensOf = (segment: string): readonly string[] =>
  segment.split(/\s+/).filter((token) => token.length > 0)

const wordsOf = (tokens: readonly string[]): readonly string[] =>
  tokens.filter((token) => !token.startsWith('-'))

const ghRestOf = (tokens: readonly string[]): readonly string[] | null => {
  const gh = tokens.indexOf('gh')
  return gh === -1 ? null : tokens.slice(gh + 1)
}

const watchesRun = (words: readonly string[]): boolean =>
  words.some((word, index) => word === 'run' && words[index + 1] === 'watch')

const watchWraps = (tokens: readonly string[]): boolean => {
  const watch = tokens.indexOf('watch')
  if (watch === -1) return false

  return tokens.slice(watch + 1).includes('gh')
}

const segmentWatches = (tokens: readonly string[]): boolean => {
  if (watchWraps(tokens)) return true

  const rest = ghRestOf(tokens)
  if (rest === null) return false

  const words = wordsOf(rest)
  if (watchesRun(words)) return true

  return rest.includes(WATCH_FLAG) && words.some((word) => GH_NOUNS.includes(word))
}

const readsPullRequestOrRun = (tokens: readonly string[]): boolean => {
  const rest = ghRestOf(tokens)
  if (rest === null) return false

  const words = wordsOf(rest)
  return words.includes('pr') || words.includes('run')
}

const pollsInLoop = (links: readonly (readonly string[])[]): boolean => {
  const loops = links.some((tokens) => LOOP_OPENERS.includes(tokens[0] ?? ''))
  if (!loops) return false

  return links.some(readsPullRequestOrRun) && links.some((tokens) => tokens.includes('sleep'))
}

export function ciWatchIntent({ command }: { command: string }): ECiWatch {
  const links = command.replace(QUOTED, '""').split(CHAIN).map(tokensOf)

  if (links.some(segmentWatches)) return ECiWatch.Watching
  if (pollsInLoop(links)) return ECiWatch.Watching

  return ECiWatch.Reading
}
