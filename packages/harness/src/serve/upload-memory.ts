import { join } from 'node:path'

import { ENoticeTone, MEMORY_DIRECTORY_NAME, type NoticePort } from '@dltech/atlas-core'

import { buildContextArchive } from '../cloud/context-archive'
import type { UserContextClient } from '../cloud/user-context-client'
import { statMemoryDirectory, type MemoryFileStat } from '../memory/walk-memory'

export type MemoryManifestEntry = { key: string; path: string; mtimeMs: number; size: number }

export type ProjectMemorySource = { directory: string; keyPrefix: string }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const entriesOf = (args: { files: readonly MemoryFileStat[]; keyPrefix: string }): MemoryManifestEntry[] =>
  args.files.map((file) => ({
    key: `${args.keyPrefix}/${file.name}`,
    path: file.path,
    mtimeMs: file.mtimeMs,
    size: file.size,
  }))

/**
 * The sandbox's own memory — user memory plus this workspace's project memory — as a flat manifest
 * of wire key, on-disk path, mtime and size. The project source arrives already resolved: its
 * directory is keyed by the repo's origin identity (so every checkout and sandbox of the repo
 * shares it) and its prefix names that identity on the wire, so the host merge can tell this
 * repo's entries from any other's. No content is read here: the manifest exists so the uploader
 * can tell whether anything changed before it pays to read and pack a single byte.
 */
export async function walkMemorySet(args: {
  atlasHome: string
  project?: ProjectMemorySource | null | undefined
}): Promise<readonly MemoryManifestEntry[]> {
  const user = entriesOf({
    files: await statMemoryDirectory(join(args.atlasHome, MEMORY_DIRECTORY_NAME)),
    keyPrefix: 'user',
  })

  if (args.project === undefined || args.project === null) return user

  const project = entriesOf({
    files: await statMemoryDirectory(args.project.directory),
    keyPrefix: args.project.keyPrefix,
  })

  return [...user, ...project]
}

/**
 * A stable summary of the walked set that never touches file content: tar bytes embed the moment
 * they were built into the gzip header, so two archives of byte-identical files never compare
 * equal even when nothing changed. Comparing this manifest instead is what makes the upload
 * skippable.
 */
export function memoryManifestOf(entries: readonly MemoryManifestEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => `${entry.key}:${entry.mtimeMs}:${entry.size}`)
    .join('\n')
}

export async function captureMemoryArchive(args: {
  entries: readonly MemoryManifestEntry[]
}): Promise<Buffer | undefined> {
  return buildContextArchive({ files: args.entries.map((entry) => ({ key: entry.key, path: entry.path })) })
}

export type MemoryUploader = { syncAfterTurn: () => Promise<void> }

/**
 * Uploads the sandbox's memory to the control plane after a turn settles, skipping the call
 * entirely when the walked file set manifest-matches the last one sent. A capture, pack or upload
 * failure is reported through the notice port and never rethrown — memory sync is accessory to the
 * turn, never a reason to fail it.
 */
export function createMemoryUploader(args: {
  client: Pick<UserContextClient, 'writeMemoryArchive'>
  atlasHome: string
  project?: ProjectMemorySource | null | undefined
  notice: NoticePort
}): MemoryUploader {
  let lastManifest: string | undefined

  return {
    async syncAfterTurn(): Promise<void> {
      let entries: readonly MemoryManifestEntry[]
      try {
        entries = await walkMemorySet({ atlasHome: args.atlasHome, project: args.project })
      } catch (error) {
        args.notice.notify({
          tone: ENoticeTone.Warn,
          text: `memory could not be captured for the cloud: ${messageOf(error)}`,
        })
        return
      }

      const manifest = memoryManifestOf(entries)
      if (manifest === lastManifest) return

      let archive: Buffer | undefined
      try {
        archive = await captureMemoryArchive({ entries })
      } catch (error) {
        args.notice.notify({
          tone: ENoticeTone.Warn,
          text: `memory could not be packed for the cloud: ${messageOf(error)}`,
        })
        return
      }

      if (archive === undefined) {
        lastManifest = manifest
        return
      }

      try {
        await args.client.writeMemoryArchive(archive)
        lastManifest = manifest
      } catch (error) {
        args.notice.notify({
          tone: ENoticeTone.Warn,
          text: `memory did not sync to the cloud: ${messageOf(error)}`,
        })
      }
    },
  }
}
