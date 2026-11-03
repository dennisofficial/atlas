import { isAbsolute, relative, sep } from 'node:path'

import type { BranchSet, GitBranch, GitWorktree } from '@dltech/atlas-protocol'

export const REF_FORMAT = '--format=%(refname:strip=2)%00%(objectname)'

const REF_SEPARATOR = '\x00'

export const branchSetsEqual = (args: { a: BranchSet; b: BranchSet }): boolean =>
  JSON.stringify(args.a) === JSON.stringify(args.b)

export const parseBranches = (text: string): readonly GitBranch[] =>
  text
    .split('\n')
    .filter((line) => line.includes(REF_SEPARATOR))
    .map((line) => {
      const [name = '', sha = ''] = line.split(REF_SEPARATOR)
      return { name, sha }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

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
  if (head === 'refs' && second === 'heads') return `${args.gitDir}${sep}refs${sep}heads`
  if (head === 'worktrees') {
    if (segments.length === 1) return args.gitDir
    if (segments[segments.length - 1] === 'HEAD') return args.gitDir
    return [args.gitDir, ...segments.slice(0, -1)].join(sep)
  }
  return null
}
