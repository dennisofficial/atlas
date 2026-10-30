import { join } from 'node:path'

import { EUserFileTree } from '@dltech/atlas-wire'

import { createApiClient } from './api-client'
import { messageOf } from './context-readiness'
import { EServeEvent, type ServeLog } from './serve-log'
import { nodeWorkspaceFiles, type WorkspaceFiles } from './workspace-files'

const INSTRUCTIONS_PATH = '.atlas/ATLAS.md'
const INSTRUCTIONS_FILE_NAME = 'ATLAS.md'
const REQUEST_TIMEOUT_MS = 10_000

type InstructionsRemote = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}

const fetchInstructions = (args: InstructionsRemote) =>
  createApiClient({
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn,
  }).userFiles.get.mutate(
    { tree: EUserFileTree.Instructions, paths: [INSTRUCTIONS_PATH] },
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  )

export type PrefetchedInstructions = ReturnType<typeof fetchInstructions>

export const startInstructionsFetch = (args: InstructionsRemote): PrefetchedInstructions => {
  const started = fetchInstructions(args)
  started.catch(() => undefined)
  return started
}

export const applyCloudInstructions = async (
  args: InstructionsRemote & {
    atlasHome: string
    log: ServeLog
    files?: WorkspaceFiles | undefined
    prefetched?: PrefetchedInstructions | undefined
  },
): Promise<void> => {
  const files = args.files ?? nodeWorkspaceFiles
  try {
    const reply = await (args.prefetched ?? fetchInstructions(args))
    const row = reply.files.find((file) => file.path === INSTRUCTIONS_PATH)
    if (row === undefined) {
      args.log({ event: EServeEvent.InstructionsAbsent })
      return
    }
    const live = row.tombstonedAt === null && row.content !== null
    const bytes = live ? Buffer.from(row.content ?? '', 'base64') : Buffer.alloc(0)
    await files.writeBytes({
      path: join(args.atlasHome, INSTRUCTIONS_FILE_NAME),
      bytes,
      overwrite: true,
    })
    args.log({ event: EServeEvent.InstructionsReady, revision: row.revision, bytes: bytes.length })
  } catch (error) {
    args.log({ event: EServeEvent.InstructionsFailed, reason: messageOf(error) })
  }
}
