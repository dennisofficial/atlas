import { homedir } from 'node:os'
import { join } from 'node:path'

import { ENoticeTone, NOTICE_WARN_MS, projectOf, type NoticePort } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { probeWorkspace } from '../workspace/probe'

import { buildContextArchive, type ArchiveFileSource } from './context-archive'
import { resolveUserLayerRoots, scanUserLayer } from './context-archive-user-layer'
import { userLayerSources } from './context-archive-user-layer-sources'
import { MAX_CONTEXT_ARCHIVE_BYTES } from './sandbox-client'

const CONTEXT_OVERFLOW_NOTICE_KEY = 'context-archive-overflow'

export type CaptureContext = () => Promise<Buffer | undefined>

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

export async function captureContextArchive(args: {
  notice: NoticePort
  cwd?: string | undefined
  home?: string | undefined
  atlasHome?: string | undefined
  projectDirectory?: string | undefined
  maxArchiveBytes?: number | undefined
}): Promise<Buffer | undefined> {
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const home = args.home ?? homedir()
  const maxBytes = args.maxArchiveBytes ?? MAX_CONTEXT_ARCHIVE_BYTES
  const projectDirectory =
    args.projectDirectory ??
    (args.cwd === undefined ? undefined : projectOf(await probeWorkspace({ cwd: args.cwd })))

  const roots = await resolveUserLayerRoots({ atlasHome, home, projectDirectory })
  const sources: ArchiveFileSource[] = [
    { key: '.atlas/mcp.json', path: join(atlasHome, 'mcp.json') },
    ...(await userLayerSources({ files: await scanUserLayer(roots), notice: args.notice })),
  ]

  const archive = await buildContextArchive({ files: sources })
  if (archive === undefined) return undefined
  if (archive.byteLength <= maxBytes) return archive

  args.notice.notify({
    key: CONTEXT_OVERFLOW_NOTICE_KEY,
    text: `the cloud context archive is ${mebibytes(archive.byteLength)}, over the ${mebibytes(maxBytes)} limit — the cloud session boots without the local MCP config, skills, instructions and memory this machine holds`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
  })
  return undefined
}
