import { isAbsolute, relative, sep } from 'node:path'

import type { BranchSet, GitBranch, GitRemote, GitWorktree } from '@dltech/atlas-protocol'

export const REF_FORMAT =
  '--format=%(refname:strip=2)%00%(objectname)%00%(push:remotename)%00%(upstream:remotename)'

export const REMOTE_URL_PATTERN = '^remote\\..*\\.url$'

const REF_SEPARATOR = '\x00'
const CHECKOUT_PREFIX = 'checkout: moving from '
const CHECKOUT_SEPARATOR = ' to '
const REWRITTEN = /[~^]/
const MAX_CHECKOUTS = 200

export const branchSetsEqual = (args: { a: BranchSet; b: BranchSet }): boolean =>
  JSON.stringify(args.a) === JSON.stringify(args.b)

const pushRemoteOf = (args: { push: string; upstream: string }): string | null => {
  const remote = args.push === '' ? args.upstream : args.push
  return remote === '' ? null : remote
}

export const parseBranches = (text: string): readonly GitBranch[] =>
  text
    .split('\n')
    .filter((line) => line.includes(REF_SEPARATOR))
    .map((line) => {
      const [name = '', sha = '', push = '', upstream = ''] = line.split(REF_SEPARATOR)
      return { name, sha, pushRemote: pushRemoteOf({ push, upstream }) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

export const parseRemotes = (text: string): readonly GitRemote[] =>
  text
    .split('\n')
    .map((line) => /^remote\.(.+)\.url\s+(\S+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[1] ?? '', url: match[2] ?? '' }))
    .filter((remote) => remote.name !== '' && remote.url !== '')
    .sort((a, b) => a.name.localeCompare(b.name))

const branchNameOrNull = (name: string): string | null =>
  name === '' || name === 'HEAD' || REWRITTEN.test(name) ? null : name

export const parseCheckouts = (texts: readonly string[]): readonly string[] => {
  const targets = texts
    .flatMap((text) => text.split('\n'))
    .flatMap((line) => {
      const message = line.slice(line.lastIndexOf('\t') + 1)
      if (!message.startsWith(CHECKOUT_PREFIX)) return []
      const target = message.slice(CHECKOUT_PREFIX.length).split(CHECKOUT_SEPARATOR).at(-1) ?? ''
      const name = branchNameOrNull(target)
      return name === null ? [] : [name]
    })
    .reverse()
  return [...new Set(targets)].slice(0, MAX_CHECKOUTS)
}

export const parseHead = (text: string): string | null => {
  const ref = text.trim()
  return ref === '' ? null : ref
}

export const parseWorktrees = (args: {
  text: string
  repoPath: string
}): readonly GitWorktree[] => {
  const blocks = args.text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '')
  const worktrees: GitWorktree[] = []
  for (const block of blocks) {
    let path: string | null = null
    let sha: string | null = null
    let branch: string | null = null
    let detached = false
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      if (line.startsWith('HEAD ')) sha = line.slice('HEAD '.length)
      if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length)
        branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
      }
      if (line === 'detached') detached = true
    }
    if (path === null || sha === null) continue
    if (path === args.repoPath) continue
    worktrees.push({ path, branch: detached ? null : branch, sha, detached })
  }
  return worktrees.sort((a, b) => a.path.localeCompare(b.path))
}

const normalizeFilename = (args: { gitDir: string; filename: string }): string => {
  if (!isAbsolute(args.filename)) return args.filename.split('/').join(sep)
  const within = relative(args.gitDir, args.filename)
  if (within.startsWith('..')) return ''
  return within
}

export const watchPathOf = (args: { gitDir: string; filename: string }): string | null => {
  const name = normalizeFilename(args)
  if (name === '') return null
  const segments = name.split(sep)
  const [head = '', second = ''] = segments
  if (head === 'HEAD' && segments.length === 1) return args.gitDir
  if (head === 'packed-refs' && segments.length === 1) return args.gitDir
  if (head === 'logs' && second === 'HEAD' && segments.length === 2) return args.gitDir
  if (head === 'refs' && second === 'heads') return `${args.gitDir}${sep}refs${sep}heads`
  if (head === 'worktrees') {
    if (segments.length === 1) return args.gitDir
    if (segments[segments.length - 1] === 'HEAD') return args.gitDir
    return [args.gitDir, ...segments.slice(0, -1)].join(sep)
  }
  return null
}
