import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { describeCommonReflogs, describeLinkedReflogs } from './capture-reflog-digest'
import { ELogEntryKind, walkLogs } from './capture-reflog-seeds'
import { commonRefsOf, digestLines, listCoveredRefs, listTreeRefSets, type CoveredTree } from './capture-refs'
import { EEntryKind, hashFile, walkTree, type SkipRule } from './capture-files'
import { absoluteCommonDir, absoluteGitDir, commonDigestSkip, stateDigestSkip } from './git-state'

const describeRoot = async ({ root, isSkipped }: { root: string; isSkipped: SkipRule }): Promise<string[]> => {
  const walk = await walkTree({ root, isSkipped })
  const lines: string[] = []
  for (const entry of walk.entries) {
    if (entry.kind === EEntryKind.Directory) continue
    if (entry.kind === EEntryKind.Symlink) lines.push(`link\0${entry.path}\0${entry.target ?? ''}`)
    else lines.push(`file\0${entry.path}\0${await hashFile(join(root, entry.path))}`)
  }
  return lines
}

export async function digestGitAdmin({ trees }: { trees: readonly CoveredTree[] }): Promise<string> {
  const sections = new Map<string, string[]>()
  const byCommon = new Map<string, (CoveredTree & { isMain: boolean })[]>()
  for (const tree of trees) {
    const cwd = tree.sourcePath
    const commonDir = await realpath(await absoluteCommonDir({ cwd }))
    const gitDir = await realpath(await absoluteGitDir({ cwd }))
    const isMain = gitDir === commonDir
    if (!sections.has(`common:${commonDir}`)) {
      sections.set(`common:${commonDir}`, await describeRoot({ root: commonDir, isSkipped: commonDigestSkip }))
    }
    sections.set(`refs:${gitDir}`, digestLines({ refs: await listCoveredRefs({ trees: [tree] }) }))
    if (!sections.has(`state:${gitDir}`)) {
      sections.set(`state:${gitDir}`, await describeRoot({ root: gitDir, isSkipped: stateDigestSkip({ isMain }) }))
      if (!isMain) sections.set(`reflogs:${gitDir}`, await describeLinkedReflogs({ gitDir }))
    }
    byCommon.set(commonDir, [...(byCommon.get(commonDir) ?? []), { ...tree, isMain }])
  }
  for (const [commonDir, members] of byCommon) {
    const covered = new Set(commonRefsOf({ sets: await listTreeRefSets({ trees: members }) }).map((ref) => ref.name))
    sections.set(`reflogs-common:${commonDir}`, await describeCommonReflogs({ commonDir, covered }))
  }
  const hash = createHash('sha256')
  for (const key of [...sections.keys()].sort()) {
    hash.update(`${key.split(':')[0]}\n${(sections.get(key) ?? []).join('\n')}\n`)
  }
  return hash.digest('hex')
}

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * A reflog is append-only, and restore merges it line-wise by timestamp (restore-git.ts
 * copyReflog), so lines a concurrent fetch appends mid-capture land in the same merged result.
 * The drift that corrupts a capture is a rewrite — history lines dropped or reordered — not an
 * append. The snapshot keeps each log's full text and its line count; the quiet-check compares
 * the captured lines as a prefix of the current lines, so an append is quiet and a rewrite is not.
 */
export type ReflogSnapshot = { path: string; lines: number; hash: string; text: string }

const snapshotLogs = async ({ root }: { root: string }): Promise<ReflogSnapshot[]> => {
  const entries = await walkLogs({ root })
  const snapshots: ReflogSnapshot[] = []
  for (const entry of entries) {
    if (entry.kind === ELogEntryKind.Symlink) continue
    const text = await readFile(entry.absolute, 'utf8').catch(() => '')
    const lines = text.split('\n').filter((line) => line.length > 0).length
    snapshots.push({ path: entry.path, lines, hash: hashOf(text), text })
  }
  return snapshots.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

export type GitAdminQuiet = { hash: string; reflogs: ReflogSnapshot[] }

/**
 * The capture quiet-check. The non-reflog administration (common dir, covered refs, per-worktree
 * state) is hashed exactly as `digestGitAdmin` hashes it, so any real drift still moves the hash;
 * the reflogs ride along as a prefix-compared snapshot so an append under a concurrent fetch does
 * not false-positive while a rewrite does.
 */
export async function snapshotGitAdminQuiet({ trees }: { trees: readonly CoveredTree[] }): Promise<GitAdminQuiet> {
  const sections = new Map<string, string[]>()
  const reflogs: ReflogSnapshot[] = []
  const byCommon = new Map<string, (CoveredTree & { isMain: boolean })[]>()
  const seenLinked = new Set<string>()
  const seenCommon = new Set<string>()
  for (const tree of trees) {
    const cwd = tree.sourcePath
    const commonDir = await realpath(await absoluteCommonDir({ cwd }))
    const gitDir = await realpath(await absoluteGitDir({ cwd }))
    const isMain = gitDir === commonDir
    if (!sections.has(`common:${commonDir}`)) {
      sections.set(`common:${commonDir}`, await describeRoot({ root: commonDir, isSkipped: commonDigestSkip }))
    }
    sections.set(`refs:${gitDir}`, digestLines({ refs: await listCoveredRefs({ trees: [tree] }) }))
    if (!sections.has(`state:${gitDir}`)) {
      sections.set(`state:${gitDir}`, await describeRoot({ root: gitDir, isSkipped: stateDigestSkip({ isMain }) }))
    }
    if (!isMain && !seenLinked.has(gitDir)) {
      seenLinked.add(gitDir)
      reflogs.push(...(await snapshotLogs({ root: join(gitDir, 'logs') })))
    }
    byCommon.set(commonDir, [...(byCommon.get(commonDir) ?? []), { ...tree, isMain }])
  }
  for (const [commonDir, members] of byCommon) {
    if (seenCommon.has(commonDir)) continue
    seenCommon.add(commonDir)
    const covered = new Set(commonRefsOf({ sets: await listTreeRefSets({ trees: members }) }).map((ref) => ref.name))
    const common = (await snapshotLogs({ root: join(commonDir, 'logs') })).filter(
      (entry) => !entry.path.startsWith('refs/') || covered.has(entry.path.slice('refs/'.length)),
    )
    reflogs.push(...common)
  }
  const hash = createHash('sha256')
  for (const key of [...sections.keys()].sort()) {
    hash.update(`${key.split(':')[0]}\n${(sections.get(key) ?? []).join('\n')}\n`)
  }
  return { hash: hash.digest('hex'), reflogs: reflogs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) }
}

const reflogQuiet = ({ before, after }: { before: ReflogSnapshot; after: ReflogSnapshot }): boolean => {
  if (after.lines < before.lines) return false
  if (after.lines === before.lines) return after.hash === before.hash
  return after.text.startsWith(before.text)
}

/**
 * True when the post-capture administration is the pre-capture one plus at most reflog appends.
 * A dropped log, a shortened log, or a log whose captured prefix changed is drift.
 */
export function gitAdminQuiet({ before, after }: { before: GitAdminQuiet; after: GitAdminQuiet }): boolean {
  if (before.hash !== after.hash) return false
  if (before.reflogs.length !== after.reflogs.length) return false
  return before.reflogs.every((prior, index) => {
    const current = after.reflogs[index]
    return current !== undefined && prior.path === current.path && reflogQuiet({ before: prior, after: current })
  })
}
