import { normalizeRepoOrigin } from '@dltech/atlas-core'
import { memoryDirectoriesFor } from '@dltech/atlas-harness'

import type { ArchiveRetry } from './context-archive-retry'
import { writeContextEntries } from './context-entries'
import { messageOf, type ContextReadiness } from './context-readiness'
import { resolveContextSource } from './context-sources'
import { readContextStamp, stampContextWithoutFailingBoot } from './context-stamp'
import { needsSkillRecovery, recoverLegacySkills } from './legacy-skill-context'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'
import type { FetchContextArchive, FetchWorkspaceSpec } from './workspace-spec'

export type { ContextReadiness } from './context-readiness'

export async function materializeContext(args: {
  fetchSpec: FetchWorkspaceSpec
  fetchArchive?: FetchContextArchive | undefined
  archiveRetry?: ArchiveRetry | undefined
  atlasHome: string
  cwd: string
  home?: string | undefined
  files?: WorkspaceFiles | undefined
}): Promise<ContextReadiness> {
  const files = args.files ?? nodeWorkspaceFiles

  const stamp = await readContextStamp({ files, atlasHome: args.atlasHome })
  if (stamp !== null && !needsSkillRecovery(stamp)) {
    return { written: 0, failed: null, projectDirectory: stamp.projectDirectory, identity: stamp.identity }
  }
  if (stamp !== null) {
    return recoverLegacySkills({
      stamp,
      files,
      atlasHome: args.atlasHome,
      cwd: args.cwd,
      home: args.home,
      fetchSpec: args.fetchSpec,
      fetchArchive: args.fetchArchive,
      archiveRetry: args.archiveRetry,
    })
  }

  let spec
  try {
    spec = await args.fetchSpec()
  } catch (error) {
    return {
      written: 0,
      failed: `the workspace spec did not answer: ${messageOf(error)}`,
      projectDirectory: null,
      identity: null,
    }
  }
  const projectDirectory = spec.projectDirectory ?? null
  const identity = spec.remoteUrl === null ? null : normalizeRepoOrigin(spec.remoteUrl)
  const readiness = (args: { written: number; failed: string | null }): ContextReadiness => ({
    written: args.written,
    failed: args.failed,
    projectDirectory,
    identity,
  })

  const resolved = await resolveContextSource({
    fetchArchive: args.fetchArchive,
    archiveRetry: args.archiveRetry,
    legacyBundle: async () => spec.contextBundle,
  })
  if ('failed' in resolved) return readiness({ written: 0, failed: resolved.failed })
  if (resolved.source === null) return readiness({ written: 0, failed: null })

  try {
    const outcome = await writeContextEntries({
      files,
      entries: resolved.source.entries,
      targets: {
        atlasHome: args.atlasHome,
        workspaceRoot: args.cwd,
        projectMemoryDirectory: memoryDirectoriesFor({
          atlasHome: args.atlasHome,
          repoRoot: args.cwd,
          identity,
        }).project,
      },
      overwrite: true,
    })
    if (outcome.failed !== null) return readiness(outcome)

    await stampContextWithoutFailingBoot({ files, atlasHome: args.atlasHome, projectDirectory, identity })
    return readiness(outcome)
  } finally {
    await resolved.source.cleanup()
  }
}
