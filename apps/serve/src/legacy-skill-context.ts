import { homedir } from 'node:os'

import { memoryDirectoriesFor } from '@dltech/atlas-harness'

import type { ArchiveRetry } from './context-archive-retry'
import {
  skillFlavourOf,
  writeContextEntries,
  COMPATIBILITY_SKILL_FLAVOURS,
  type ContextEntry,
  type ContextTargets,
} from './context-entries'
import type { ContextReadiness } from './context-readiness'
import { ESkillLayout, stampContextWithoutFailingBoot, type ContextStamp } from './context-stamp'
import { resolveContextSource } from './context-sources'
import { readLegacyHomeSkills } from './legacy-home-skills'
import type { WorkspaceFiles } from './workspace-files'
import type { FetchContextArchive, FetchWorkspaceSpec } from './workspace-spec'

export const recoverLegacySkills = async (args: {
  stamp: ContextStamp
  files: WorkspaceFiles
  atlasHome: string
  cwd: string
  home: string | undefined
  fetchSpec: FetchWorkspaceSpec
  fetchArchive: FetchContextArchive | undefined
  archiveRetry: ArchiveRetry | undefined
}): Promise<ContextReadiness> => {
  const { stamp, files } = args
  const readiness = (args: { written: number; failed: string | null }): ContextReadiness => ({
    written: args.written,
    failed: args.failed,
    projectDirectory: stamp.projectDirectory,
    identity: stamp.identity,
  })
  const targets: ContextTargets = {
    atlasHome: args.atlasHome,
    workspaceRoot: args.cwd,
    projectMemoryDirectory: memoryDirectoriesFor({
      atlasHome: args.atlasHome,
      repoRoot: args.cwd,
      identity: stamp.identity,
    }).project,
  }
  const writeMissing = (entries: readonly ContextEntry[]) =>
    writeContextEntries({ files, entries, targets, overwrite: false })

  const legacyHome = await readLegacyHomeSkills(args.home ?? homedir())
  if ('failed' in legacyHome) return readiness({ written: 0, failed: legacyHome.failed })
  const { present, entries: homeEntries } = legacyHome.skills

  const imported = await writeMissing(homeEntries)
  if (imported.failed !== null) return readiness(imported)
  let written = imported.written

  if (present.size < COMPATIBILITY_SKILL_FLAVOURS.length) {
    const resolved = await resolveContextSource({
      fetchArchive: args.fetchArchive,
      archiveRetry: args.archiveRetry,
      legacyBundle: async () => (await args.fetchSpec()).contextBundle,
    })
    if ('failed' in resolved) return readiness({ written, failed: resolved.failed })
    if (resolved.source === null) {
      return readiness({ written, failed: 'no context archive or bundle is available to recover skills from' })
    }

    try {
      const absent = resolved.source.entries.filter((entry) => {
        const flavour = skillFlavourOf(entry.path)
        return flavour !== null && !present.has(flavour)
      })
      const restored = await writeMissing(absent)
      written += restored.written
      if (restored.failed !== null) return readiness({ written, failed: restored.failed })
    } finally {
      await resolved.source.cleanup()
    }
  }

  await stampContextWithoutFailingBoot({
    files,
    atlasHome: args.atlasHome,
    projectDirectory: stamp.projectDirectory,
    identity: stamp.identity,
  })
  return readiness({ written, failed: null })
}

export const needsSkillRecovery = (stamp: ContextStamp): boolean => stamp.skillLayout !== ESkillLayout.PersistentV1
