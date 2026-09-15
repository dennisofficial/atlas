import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'

import type { AgentFileSystemPort, ThreadId } from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../execution/local-filesystem'

const DEFAULT_FILE_MODE = 0o644

const PERMISSION_BITS = 0o777

const temporaryBeside = (path: string): string =>
  join(dirname(path), `.${basename(path)}.${randomUUID()}.atlas-partial`)

const MAX_LINK_HOPS = 40

async function resolveLinkChain(args: {
  path: string
  files: AgentFileSystemPort
  threadId?: ThreadId | undefined
}): Promise<string> {
  let current = args.path
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    const target = await args.files.readLink({ path: current, threadId: args.threadId })
    if (target === null) return current
    current = isAbsolute(target) ? target : join(dirname(current), target)
  }
  throw new Error(`Cannot write ${args.path}: too many levels of symbolic links`)
}

export async function writeFileAtomically(args: {
  path: string
  content: string
  mode?: number | undefined
  files?: AgentFileSystemPort | undefined
  threadId?: ThreadId | undefined
}): Promise<number> {
  const files = args.files ?? new LocalFileSystemPort()
  const path = await resolveLinkChain({ path: args.path, files, threadId: args.threadId })
  await files.mkdir({ path: dirname(path), threadId: args.threadId })

  const temporary = temporaryBeside(path)
  const mode = args.mode === undefined ? DEFAULT_FILE_MODE : args.mode & PERMISSION_BITS

  try {
    await files.writeFile({ path: temporary, content: args.content, mode, threadId: args.threadId })
    await files.rename({ from: temporary, to: path, threadId: args.threadId })
  } catch (error) {
    await files.removeFile({ path: temporary, threadId: args.threadId }).catch(() => undefined)
    throw error
  }

  return Buffer.byteLength(args.content, 'utf8')
}
