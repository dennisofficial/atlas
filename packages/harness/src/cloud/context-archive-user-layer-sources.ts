import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import { MAX_USER_LAYER_FILE_BYTES, megabytes } from '../user-layer-sync/limits'
import { readLocalFile } from '../user-layer-sync/local-file'

import type { ArchiveFileSource } from './context-archive'
import { userLayerArchiveKey, type UserLayerArchiveFile } from './context-archive-user-layer'

function reportOversize(args: { notice: NoticePort; file: UserLayerArchiveFile; byteLength: number }): void {
  const label = `${args.file.tree}/${args.file.key}`
  args.notice.notify({
    key: `user-layer-oversize:${label}`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
    text: `not carrying ${label} to the cloud session: ${megabytes(args.byteLength)} MB is over the ${megabytes(MAX_USER_LAYER_FILE_BYTES)} MB limit`,
  })
}

export async function userLayerSources(args: {
  files: readonly UserLayerArchiveFile[]
  notice: NoticePort
}): Promise<readonly ArchiveFileSource[]> {
  const sources: ArchiveFileSource[] = []
  for (const file of args.files) {
    const local = await readLocalFile(file.path)
    if (!local.exists || local.text === null) continue
    if (local.text.bytes.byteLength > MAX_USER_LAYER_FILE_BYTES) {
      reportOversize({ notice: args.notice, file, byteLength: local.text.bytes.byteLength })
      continue
    }
    sources.push({ key: userLayerArchiveKey({ tree: file.tree, key: file.key }), path: file.path })
  }
  return sources
}
