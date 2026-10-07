import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import type { ArchiveMount, Relocation } from './archive'
import { assertPortable, EEntryKind, type TreeEntry } from './capture-files'
import type { WorkspaceLayout } from './capture-layout'
import { indexedObjectSeeds } from './capture-index-seeds'
import { packReachableObjects } from './capture-pack'
import { reflogSeeds } from './capture-reflog-seeds'
import { commonRefsOf, listTreeRefSets, refTipsOf, stageLogicalRefs } from './capture-refs'
import { collectCommonAdmin, mergeStateSeeds } from './git-state'

const MATERIALIZED_DIRECTORY = 'materialized-objects'
const LOGICAL_REFS_DIRECTORY = 'logical-refs'
const REF_LOG_PREFIX = 'logs/refs/'
const LOGS_PREFIX = 'logs/'
const LOGS_DIRECTORY = 'logs'

const dropUncoveredReflogs = ({ entries, covered }: { entries: readonly TreeEntry[]; covered: ReadonlySet<string> }): TreeEntry[] =>
  entries.filter(
    (entry) =>
      entry.kind === EEntryKind.Directory ||
      !entry.path.startsWith(REF_LOG_PREFIX) ||
      covered.has(entry.path.slice('logs/'.length)),
  )

export async function stageSharedGit({
  stage,
  layout,
  stateRoots,
  commonDir,
}: {
  stage: string
  layout: WorkspaceLayout
  stateRoots: readonly string[]
  commonDir: string
}): Promise<{ mounts: ArchiveMount[]; relocated: Relocation[] }> {
  const admin = await collectCommonAdmin({ commonDir })
  assertPortable({ unportable: admin.unportable, label: commonDir })
  const outputDir = join(stage, MATERIALIZED_DIRECTORY)
  await mkdir(outputDir)
  const sets = await listTreeRefSets({ trees: layout.trees })
  const commonRefs = commonRefsOf({ sets })
  const entries = dropUncoveredReflogs({ entries: admin.entries, covered: new Set(commonRefs.map((ref) => ref.name)) })
  const resolvedCommon = await realpath(commonDir)
  const linkedRoots = (await Promise.all(stateRoots.map(async (gitDir) => ((await realpath(gitDir)) === resolvedCommon ? [] : [join(gitDir, LOGS_DIRECTORY)])))).flat()
  const reflogSeedIds = await reflogSeeds({
    cwd: layout.trees.find((tree) => tree.isMain)?.sourcePath ?? layout.trees[0]?.sourcePath ?? commonDir,
    commonLogFiles: entries.filter((entry) => entry.kind === EEntryKind.File && entry.path.startsWith(LOGS_PREFIX)).map((entry) => join(commonDir, entry.path)),
    linkedLogRoots: linkedRoots,
  })
  const stateSeeds = await Promise.all(stateRoots.map((gitDir) => mergeStateSeeds({ gitDir })))
  const indexSeeds = await Promise.all(layout.trees.map((tree) => indexedObjectSeeds({ cwd: tree.sourcePath })))
  const seeds = [
    ...new Set([
      ...refTipsOf({ sets }),
      ...layout.trees.map((tree) => tree.head).filter((head): head is string => head !== null),
      ...stateSeeds.flat(),
      ...indexSeeds.flat(),
      ...reflogSeedIds,
    ]),
  ]
  const packer = layout.trees.find((tree) => tree.isMain) ?? layout.trees[0]
  if (packer === undefined) throw new Error('Nothing to capture')
  const names = await packReachableObjects({ cwd: packer.sourcePath, commonDir, outputDir, seeds })
  const refsDir = join(stage, LOGICAL_REFS_DIRECTORY)
  await mkdir(refsDir)
  return {
    mounts: [{ mountPath: 'git', sourcePath: commonDir, entries }],
    relocated: [
      { stageDirectory: MATERIALIZED_DIRECTORY, archiveDirectory: 'git/objects/pack', names: [...new Set(names)] },
      {
        stageDirectory: LOGICAL_REFS_DIRECTORY,
        archiveDirectory: 'git',
        names: await stageLogicalRefs({ refs: commonRefs, outputDir: refsDir }),
      },
    ],
  }
}
