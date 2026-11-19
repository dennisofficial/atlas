import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import type { EventFrame } from '@dltech/atlas-host'
import {
  TERMINAL_STREAM_BUFFER_BYTES,
  terminalExitEventSchema,
  terminalOutputEventSchema,
  type TerminalStreamFrame,
} from '@dltech/atlas-protocol'
import { POD_OPS, type PodOps } from '../../../agent'
import { TerminalService } from '../../platform/control/terminal.service'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { HOST_ABSENT } from './session-stream.router'
import { TerminalStreamQueue } from './terminal-stream-queue'

export type TerminalStreamAttachArgs = {
  userId: string
  sessionId: string
  cursors: readonly { terminalId: string; offset: number }[]
  signal?: AbortSignal | undefined
}

const bytesOf = (base64: string): number => Buffer.from(base64, 'base64').length

@Injectable()
export class TerminalStreamService {
  constructor(
    private readonly terminals: TerminalService,
    private readonly drain: DrainStateService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
  ) {}

  async *attach(args: TerminalStreamAttachArgs): AsyncGenerator<TerminalStreamFrame> {
    await this.terminals.requireOwned(args)
    const ops = this.ops
    if (ops === null) throw new ServiceUnavailableException(HOST_ABSENT)
    if (this.drain.isDraining())
      throw new ServiceUnavailableException('the api is restarting — retry the stream')
    yield { type: 'ready', sessionId: args.sessionId }
    const queue = new TerminalStreamQueue(TERMINAL_STREAM_BUFFER_BYTES)
    const next = new Map<string, number>()
    const dispose = ops.events({
      sessionId: args.sessionId,
      listener: (frame) => this.forward({ frame, sessionId: args.sessionId, queue, next }),
      onClose: (reason) => queue.end(this.drain.isDraining() ? 'restarted' : reason),
    })
    if (dispose === null) {
      yield { type: 'parked' }
      return
    }
    const abort = (): void => queue.end()
    args.signal?.addEventListener('abort', abort)
    try {
      const replayed = yield* this.replay({
        userId: args.userId,
        sessionId: args.sessionId,
        cursors: args.cursors,
        next,
      })
      if (!replayed) {
        yield { type: 'closed', reason: 'asleep' }
        return
      }
      for (;;) {
        const frame = await queue.next()
        if (frame === undefined) return
        yield frame
      }
    } finally {
      args.signal?.removeEventListener('abort', abort)
      dispose()
    }
  }

  private async *replay(args: {
    userId: string
    sessionId: string
    cursors: readonly { terminalId: string; offset: number }[]
    next: Map<string, number>
  }): AsyncGenerator<TerminalStreamFrame, boolean> {
    for (const cursor of args.cursors) {
      let at = cursor.offset
      for (;;) {
        const page = await this.terminals
          .read({
            userId: args.userId,
            sessionId: args.sessionId,
            terminalId: cursor.terminalId,
            offset: at,
          })
          .catch(() => undefined)
        if (page === undefined) return false
        const bytes = bytesOf(page.data)
        if (bytes > 0)
          yield {
            type: 'output',
            terminalId: cursor.terminalId,
            offset: page.offset,
            data: page.data,
          }
        at = bytes === 0 ? at : page.offset + bytes
        if (at < page.totalBytes && bytes > 0) continue
        if (page.exited !== null)
          yield {
            type: 'exit',
            terminalId: cursor.terminalId,
            exitCode: page.exited.exitCode,
            signal: page.exited.signal,
          }
        break
      }
      args.next.set(cursor.terminalId, at)
    }
    return true
  }

  private forward(args: {
    frame: EventFrame
    sessionId: string
    queue: TerminalStreamQueue
    next: Map<string, number>
  }): void {
    const output = terminalOutputEventSchema.safeParse(args.frame.event)
    if (output.success) {
      const at = args.next.get(output.data.terminalId) ?? 0
      if (output.data.offset < at) return
      args.next.set(output.data.terminalId, output.data.offset + bytesOf(output.data.data))
      args.queue.push({
        type: 'output',
        terminalId: output.data.terminalId,
        offset: output.data.offset,
        data: output.data.data,
      })
      return
    }
    const exit = terminalExitEventSchema.safeParse(args.frame.event)
    if (!exit.success) return
    void this.terminals
      .recordExit({
        sessionId: args.sessionId,
        terminalId: exit.data.terminalId,
        exitCode: exit.data.exitCode,
        signal: exit.data.signal,
      })
      .catch(() => undefined)
    args.queue.push({
      type: 'exit',
      terminalId: exit.data.terminalId,
      exitCode: exit.data.exitCode,
      signal: exit.data.signal,
    })
  }
}
