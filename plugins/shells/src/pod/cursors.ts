import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { ShellInfo } from '@dltech/atlas-protocol'

import { readShell, type DaemonCall } from './daemon'

export const DEFAULT_READ_LIMIT = 32_768

export const MAX_READ_LIMIT = 1024 * 1024

export class ShellCursors {
  private readonly offsets = new Map<string, number>()

  get(shellId: string): number {
    return this.offsets.get(shellId) ?? 0
  }

  set(shellId: string, offset: number): void {
    this.offsets.set(shellId, offset)
  }

  reset(shellId: string): void {
    this.offsets.delete(shellId)
  }
}

export type ShellDelta = {
  text: string
  droppedCharacters: number
  remainingCharacters: number
  info: ShellInfo
}

export const readDelta = async (args: {
  ctx: Pick<PluginPodContext, 'call'>
  cursors: ShellCursors
  shellId: string
  limit?: number | undefined
  advance?: boolean | undefined
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ShellDelta>> => {
  const requested = args.cursors.get(args.shellId)
  const read = await readShell({
    ctx: args.ctx,
    shellId: args.shellId,
    offset: requested,
    limit: Math.min(args.limit ?? DEFAULT_READ_LIMIT, MAX_READ_LIMIT),
    signal: args.signal,
  })
  if (!read.ok) return read
  const chunk = read.value
  const bytes = Buffer.from(chunk.bytes, 'base64')
  const end = chunk.offset + bytes.byteLength
  if (args.advance !== false) args.cursors.set(args.shellId, end)
  return {
    ok: true,
    value: {
      text: bytes.toString('utf8'),
      droppedCharacters: Math.max(0, chunk.offset - requested),
      remainingCharacters: Math.max(0, chunk.totalBytes - end),
      info: chunk.info,
    },
  }
}
