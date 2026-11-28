import { StringDecoder } from 'node:string_decoder'

import type { PodRuntimeContext } from '@dltech/atlas-plugin-sdk'

import { readShell } from './daemon'

export const LIVE_READ_LIMIT = 16_384

type ShellStream = {
  readOffset: number
  published: number
  decoder: StringDecoder
  pumping: boolean
  dirty: boolean
}

export class ShellLive {
  private readonly streams = new Map<string, ShellStream>()
  private disposed = false

  constructor(private readonly ctx: Pick<PodRuntimeContext, 'call' | 'live' | 'log'>) {}

  note(shellId: string): void {
    if (this.disposed) return
    const stream = this.streamOf(shellId)
    stream.dirty = true
    if (stream.pumping) return
    stream.pumping = true
    void this.drain({ shellId, stream })
  }

  forget(shellId: string): void {
    this.streams.delete(shellId)
  }

  reset(): void {
    this.streams.clear()
  }

  dispose(): void {
    this.disposed = true
    this.reset()
  }

  private streamOf(shellId: string): ShellStream {
    const kept = this.streams.get(shellId)
    if (kept !== undefined) return kept
    const stream: ShellStream = {
      readOffset: 0,
      published: 0,
      decoder: new StringDecoder('utf8'),
      pumping: false,
      dirty: false,
    }
    this.streams.set(shellId, stream)
    return stream
  }

  private async drain(args: { shellId: string; stream: ShellStream }): Promise<void> {
    const { shellId, stream } = args
    try {
      while (stream.dirty && this.streams.get(shellId) === stream) {
        stream.dirty = false
        await this.pump(args)
      }
    } catch (error) {
      this.ctx.log(`shells: streaming ${shellId} stopped: ${String(error)}`)
    } finally {
      stream.pumping = false
    }
  }

  private async pump(args: { shellId: string; stream: ShellStream }): Promise<void> {
    const { shellId, stream } = args
    for (;;) {
      const read = await readShell({
        ctx: this.ctx,
        shellId,
        offset: stream.readOffset,
        limit: LIVE_READ_LIMIT,
      })
      if (this.streams.get(shellId) !== stream) return
      if (!read.ok) {
        this.ctx.log(`shells: streaming ${shellId} failed: ${read.reason}`)
        return
      }
      const bytes = Buffer.from(read.value.bytes, 'base64')
      if (bytes.byteLength === 0) return
      stream.readOffset = read.value.offset + bytes.byteLength
      const text = stream.decoder.write(bytes)
      if (text === '') continue
      const offset = stream.published
      stream.published = offset + text.length
      this.ctx.live({ type: 'shell-output', shellId, offset, text })
    }
  }
}

export const shellLiveOf = (ctx: PodRuntimeContext): ShellLive => {
  const live = new ShellLive(ctx)
  ctx.onDaemonEvent((frame) => {
    if (frame.event.type === 'shells.output') live.note(frame.event.shellId)
    if (frame.event.type === 'shells.ended') live.forget(frame.event.shellId)
  })
  ctx.onReset(() => live.reset())
  ctx.onDispose(() => live.dispose())
  return live
}
