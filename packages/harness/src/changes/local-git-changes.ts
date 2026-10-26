import { EChangeScope, type ChangedFileWire, type ReadGitChangesReply } from '@dltech/atlas-wire'

import { runGit } from '../workspace/run-git'

import { GitChangesPort } from './git-changes.port'
import { parseUnifiedDiff } from './parse-unified-diff'

export const MAX_CHANGED_FILES = 300
const MAX_UNTRACKED_FILES = 200
const UNTRACKED_BATCH = 16
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const DEFAULT_BRANCH_FALLBACKS = ['origin/main', 'origin/master', 'main', 'master']

const DIFF = [
  '-c',
  'core.quotepath=off',
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '-M',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-U3',
]

const NO_INDEX = [
  '-c',
  'core.quotepath=off',
  'diff',
  '--no-index',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-U3',
  '--',
  '/dev/null',
]

export class LocalGitChanges extends GitChangesPort {
  constructor(private readonly args: { root: string }) {
    super()
  }

  async read({ scope }: { scope: EChangeScope }): Promise<ReadGitChangesReply> {
    const head = await this.revision('HEAD')
    if (scope === EChangeScope.LastCommit) return await this.lastCommit(head)

    const base = scope === EChangeScope.All ? await this.mergeBase(head) : head
    const files = await this.againstWorkingTree(base ?? EMPTY_TREE)
    return this.reply({ scope, base, files })
  }

  private async git(args: readonly string[]) {
    return await runGit({ args, cwd: this.args.root })
  }

  private async revision(name: string): Promise<string | null> {
    const run = await this.git(['rev-parse', '--verify', '--quiet', name])
    const sha = run.stdout.trim()
    return run.ok && sha !== '' ? sha : null
  }

  private async mergeBase(head: string | null): Promise<string | null> {
    if (head === null) return null
    const named = await this.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
    const candidates = [named.stdout.trim(), ...DEFAULT_BRANCH_FALLBACKS].filter(
      (candidate) => candidate !== '',
    )
    for (const candidate of candidates) {
      const run = await this.git(['merge-base', 'HEAD', candidate])
      const sha = run.stdout.trim()
      if (run.ok && sha !== '') return sha
    }
    return head
  }

  private async lastCommit(head: string | null): Promise<ReadGitChangesReply> {
    if (head === null) return this.reply({ scope: EChangeScope.LastCommit, base: null, files: [] })
    const parent = (await this.revision('HEAD^')) ?? EMPTY_TREE
    const run = await this.git([...DIFF, parent, head])
    return this.reply({
      scope: EChangeScope.LastCommit,
      base: parent === EMPTY_TREE ? null : parent,
      files: parseUnifiedDiff(run.stdout),
    })
  }

  private async againstWorkingTree(base: string): Promise<ChangedFileWire[]> {
    const tracked = await this.git([...DIFF, base])
    return [...parseUnifiedDiff(tracked.stdout), ...(await this.untracked())]
  }

  private async untracked(): Promise<ChangedFileWire[]> {
    const listed = await this.git(['ls-files', '-z', '--others', '--exclude-standard'])
    const paths = listed.stdout.split('\0').filter((path) => path !== '')
    const files: ChangedFileWire[] = []
    for (
      let start = 0;
      start < Math.min(paths.length, MAX_UNTRACKED_FILES);
      start += UNTRACKED_BATCH
    ) {
      const batch = paths.slice(start, Math.min(start + UNTRACKED_BATCH, MAX_UNTRACKED_FILES))
      const diffs = await Promise.all(batch.map((path) => this.git([...NO_INDEX, path])))
      for (const diff of diffs) files.push(...parseUnifiedDiff(diff.stdout))
    }
    return files
  }

  private reply(args: {
    scope: EChangeScope
    base: string | null
    files: ChangedFileWire[]
  }): ReadGitChangesReply {
    const sorted = [...args.files].sort((left, right) => left.path.localeCompare(right.path))
    return {
      scope: args.scope,
      base: args.base,
      files: sorted.slice(0, MAX_CHANGED_FILES),
      truncated: sorted.length > MAX_CHANGED_FILES,
    }
  }
}
