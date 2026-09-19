import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ENoticeTone, MEMORY_DIRECTORY_NAME, type NoticePort } from '@dltech/atlas-core'

import type { UserContextClient } from '../cloud/user-context-client'
import { memoryDirectoriesFor } from '../memory/read-memory'

export type MemoryFileEntry = { content: string; mtime: number }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const addFlatDirectory = async (args: {
  files: Record<string, MemoryFileEntry>
  directory: string
  keyPrefix: string
}): Promise<void> => {
  let entries
  try {
    entries = await readdir(args.directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(args.directory, entry.name)
    try {
      const [content, stats] = await Promise.all([readFile(path), stat(path)])
      args.files[`${args.keyPrefix}/${entry.name}`] = {
        content: content.toString('base64'),
        mtime: stats.mtimeMs,
      }
    } catch {
      continue
    }
  }
}

/**
 * The sandbox's own memory — user memory plus this workspace's project memory — as a JSON map of
 * `user/<name>` and `project/<name>` to base64 content and mtime, ready to hand the control plane
 * so it survives the sandbox dying. Mirrors the flat, non-recursive walk `captureContextBundle`
 * uses on the Mac side, so a nested `projects/` directory under user memory is never swept in.
 */
export async function captureMemoryBundle(args: {
  atlasHome: string
  cwd: string
}): Promise<string | undefined> {
  const files: Record<string, MemoryFileEntry> = {}

  await addFlatDirectory({
    files,
    directory: join(args.atlasHome, MEMORY_DIRECTORY_NAME),
    keyPrefix: 'user',
  })

  const projectMemory = memoryDirectoriesFor({ atlasHome: args.atlasHome, repoRoot: args.cwd }).project
  await addFlatDirectory({ files, directory: projectMemory, keyPrefix: 'project' })

  if (Object.keys(files).length === 0) return undefined
  return JSON.stringify(files)
}

export type MemoryUploader = { syncAfterTurn: () => Promise<void> }

/**
 * Uploads the sandbox's memory to the control plane after a turn settles, skipping the call
 * entirely when the captured bundle byte-matches the last one sent. A capture or upload failure
 * is reported through the notice port and never rethrown — memory sync is accessory to the turn,
 * never a reason to fail it.
 */
export function createMemoryUploader(args: {
  client: Pick<UserContextClient, 'writeMemoryBundle'>
  atlasHome: string
  cwd: string
  notice: NoticePort
}): MemoryUploader {
  let lastUploaded: string | undefined

  return {
    async syncAfterTurn(): Promise<void> {
      let bundle: string | undefined
      try {
        bundle = await captureMemoryBundle({ atlasHome: args.atlasHome, cwd: args.cwd })
      } catch (error) {
        args.notice.notify({
          tone: ENoticeTone.Warn,
          text: `memory could not be captured for the cloud: ${messageOf(error)}`,
        })
        return
      }

      if (bundle === undefined || bundle === lastUploaded) return

      try {
        await args.client.writeMemoryBundle(bundle)
        lastUploaded = bundle
      } catch (error) {
        args.notice.notify({
          tone: ENoticeTone.Warn,
          text: `memory did not sync to the cloud: ${messageOf(error)}`,
        })
      }
    },
  }
}
