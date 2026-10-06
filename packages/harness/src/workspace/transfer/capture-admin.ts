import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { describeCommonReflogs, describeLinkedReflogs } from './capture-reflog-digest'
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
