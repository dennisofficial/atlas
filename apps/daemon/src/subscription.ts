import { readFileSync } from 'node:fs'

import type { CallResult, DaemonFrame } from '@dltech/atlas-protocol'

export class KeySubscription {
  private floor = 0
  private buffered: { offset: number; bytes: Uint8Array }[] = []
  private live = false
  sentResult = false

  constructor(
    private readonly key: string,
    private readonly send: (frame: DaemonFrame) => void,
  ) {}

  readonly sink = {
    chunk: (chunk: { offset: number; bytes: Uint8Array }): void => {
      if (this.live) {
        if (chunk.offset >= this.floor) this.sendChunk(chunk)
        return
      }
      this.buffered.push(chunk)
    },
    result: ({ result }: { result: unknown }): void => {
      this.sentResult = true
      this.send({ kind: 'result', key: this.key, result: result as CallResult })
    },
  }

  sendChunk(chunk: { offset: number; bytes: Uint8Array }): void {
    this.send({
      kind: 'output',
      key: this.key,
      offset: chunk.offset,
      bytes: Buffer.from(chunk.bytes).toString('base64'),
    })
  }

  goLive(args: { floor: number }): void {
    this.floor = args.floor
    for (const chunk of this.buffered) {
      if (chunk.offset >= this.floor) this.sendChunk(chunk)
    }
    this.buffered = []
    this.live = true
  }
}

export const daemonMemory = (
  workGroup: string | undefined,
): { current: number; max: number } | undefined => {
  if (workGroup === undefined || workGroup === '') return undefined
  try {
    const current = Number(readFileSync(`${workGroup}/memory.current`, 'utf8').trim())
    const max = Number(readFileSync(`${workGroup}/memory.max`, 'utf8').trim())
    if (!Number.isInteger(current) || !Number.isInteger(max)) return undefined
    return { current, max }
  } catch {
    return undefined
  }
}
