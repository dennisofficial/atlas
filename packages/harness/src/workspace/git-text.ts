import type { GitRun } from './run-git'

export const ATLAS_GIT_IDENTITY = [
  '-c',
  'user.name=Atlas',
  '-c',
  'user.email=atlas@localhost',
] as const

export const gitOneLine = (run: GitRun): string | null => {
  if (!run.ok) return null
  const line = run.stdout.split('\n')[0]?.trim() ?? ''
  return line.length === 0 ? null : line
}

export const gitLines = (run: GitRun): string[] =>
  run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

export const gitMessageOf = (run: GitRun): string => {
  const said = `${run.stderr}${run.stdout}`.trim()
  return said.length === 0 ? 'git said nothing and exited non-zero' : said
}
