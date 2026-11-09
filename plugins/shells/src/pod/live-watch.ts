import { StringDecoder } from 'node:string_decoder'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { readShell } from './daemon'

export const LIVE_READ_LIMIT = 16_384

type ShellStream = {
  generation: number
  readOffset: number
  published: number
  decoder: StringDecoder
}

export class ShellLive {
  private readonly streams = new Map<string, ShellStream>()
  private readonly generations = new Map<string, number>()
  private readonly pumping = new Set<string>()
  private readonly dirty = new Set<string>()

  constructor(private readonly ctx: PluginPodContext) {}

  note(shellId: string): void {
    this.dirty.add(shellId)
    if (this.pumping.has(shellId)) return
    this.pumping.add(shellId)
    void this.drain(shellId)
  }

  forget(shellId: string): void {
    this.generations.set(shellId, this.generationOf(shellId) + 1)
    this.streams.delete(shellId)
    this.dirty.delete(shellId)
  }

  private generationOf(shellId: string): number {
    return this.generations.get(shellId) ?? 0
  }

  private streamOf(shellId: string): ShellStream {
    const kept = this.streams.get(shellId)
    if (kept !== undefined) return kept
    const stream: ShellStream = {
      generation: this.generationOf(shellId),
      readOffset: 0,
      published: 0,
      decoder: new StringDecoder('utf8'),
    }
    this.streams.set(shellId, stream)
    return stream
  }

  private async drain(shellId: string): Promise<void> {
    try {
      while (this.dirty.delete(shellId)) await this.pump(shellId)
    } finally {
      this.pumping.delete(shellId)
    }
  }

  private async pump(shellId: string): Promise<void> {
    const stream = this.streamOf(shellId)
    const generation = stream.generation
    for (;;) {
      const read = await readShell({
        ctx: this.ctx,
        shellId,
        offset: stream.readOffset,
        limit: LIVE_READ_LIMIT,
      })
      if (generation !== this.generationOf(shellId)) return
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
