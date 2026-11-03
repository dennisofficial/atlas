import { appendOutput, readOutput } from '../../journal'
import { type ManagedLog, ManagedProcess } from '../../process/managed'
import type { OpHandler, OpRegistry } from '../registry'

class CallLog implements ManagedLog {
  constructor(
    private readonly home: string,
    private readonly key: string,
  ) {}

  async append(args: { bytes: Uint8Array }): Promise<void> {
    await appendOutput({ home: this.home, key: this.key, bytes: args.bytes })
  }

  async readFrom(args: { offset: number }): Promise<Uint8Array> {
    return await readOutput({ home: this.home, key: this.key, offset: args.offset })
  }

  async size(): Promise<number> {
    return (await this.readFrom({ offset: 0 })).length
  }
}

const KILLED_EXIT_CODE = 143

const execHandler: OpHandler = {
  streams: true,
  async exec(args) {
    if (args.op.op !== 'exec') throw new Error('exec handler received another op')
    const op = args.op
    args.ctx.noteSpawn()
    const spawned = ManagedProcess.spawn({
      cmd: op.argv,
      cwd: op.cwd,
      env: { ...args.ctx.env, ...op.env },
      log: new CallLog(args.ctx.home, args.ctx.key),
      onChunk: (chunk) => void args.ctx.onChunk(chunk),
    })

    let timedOut = false
    const timer =
      op.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            spawned.kill()
          }, op.timeoutMs)

    const output = (async (): Promise<unknown> => {
      const exit = await spawned.exit()
      if (timer !== undefined) clearTimeout(timer)
      const bytes = await readOutput({ home: args.ctx.home, key: args.ctx.key, offset: 0 })
      const text = new TextDecoder().decode(bytes)
      if (exit.oom) return { exitCode: exit.exitCode, output: text, error: 'killed: out of memory' }
      if (args.ctx.cancel.cancelled) {
        return { exitCode: exit.exitCode, output: text, error: 'cancelled' }
      }
      if (timedOut) {
        return { exitCode: exit.exitCode ?? KILLED_EXIT_CODE, output: text, error: 'timed out' }
      }
      return { exitCode: exit.exitCode, output: text }
    })()

    return {
      output,
      cancel: () => {
        args.ctx.cancel.cancelled = true
        spawned.kill()
      },
    }
  },
}

export const execOps: OpRegistry = { exec: execHandler }
