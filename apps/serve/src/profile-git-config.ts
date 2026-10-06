import type { GitRunner } from './materialize-workspace'

export type GitConfigEntry = readonly [key: string, value: string]

export const writeGitConfigs = async (args: {
  git: GitRunner
  cwd: string
  entries: readonly GitConfigEntry[]
}): Promise<string | null> => {
  for (const [key, value] of args.entries) {
    const written = await args.git({ args: ['config', key, value], cwd: args.cwd })
    if (!written.ok) return written.stderr.trim() || `git config ${key} failed`
  }
  return null
}

export const readGitConfig = async (args: {
  git: GitRunner
  cwd: string
  key: string
}): Promise<{ value: string } | { failure: string }> => {
  const read = await args.git({ args: ['config', args.key], cwd: args.cwd })
  if (!read.ok) return { failure: read.stderr.trim() || `git config ${args.key} is unset` }
  return { value: read.stdout.trim() }
}

export const verifyGitConfigs = async (args: {
  git: GitRunner
  cwd: string
  entries: readonly GitConfigEntry[]
}): Promise<string | null> => {
  for (const [key, expected] of args.entries) {
    const read = await readGitConfig({ git: args.git, cwd: args.cwd, key })
    if ('failure' in read) return read.failure
    if (read.value !== expected) return `git config ${key} reads back as a different value`
  }
  return null
}
