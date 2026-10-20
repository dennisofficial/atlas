import type { ProcessHandle, ProcessPort, SpawnCommand } from '@dltech/atlas-core'

export type CannedExec = {
  stdout?: string | Uint8Array
  stderr?: string
  exitCode?: number
  block?: boolean
}

const streamOf = (payload: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      if (payload.length > 0) controller.enqueue(payload)
      controller.close()
    },
  })

const bytesOf = (payload: string | Uint8Array | undefined): Uint8Array => {
  if (payload === undefined) return new Uint8Array()
  return typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
}

export class FakeProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  terminated = 0

  constructor(private readonly answer: (cmd: readonly string[]) => CannedExec) {}

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const canned = this.answer(args.cmd)

    if (canned.block === true) {
      let stdoutController!: ReadableStreamDefaultController<Uint8Array>
      let stderrController!: ReadableStreamDefaultController<Uint8Array>
      let resolveExit!: (code: number) => void
      return {
        stdout: new ReadableStream<Uint8Array>({
          start: (controller) => {
            stdoutController = controller
          },
        }),
        stderr: new ReadableStream<Uint8Array>({
          start: (controller) => {
            stderrController = controller
          },
        }),
        exited: new Promise<number>((resolve) => {
          resolveExit = resolve
        }),
        terminate: () => {
          this.terminated += 1
          stdoutController.close()
          stderrController.close()
          resolveExit(143)
        },
      }
    }

    return {
      stdout: streamOf(bytesOf(canned.stdout)),
      stderr: streamOf(bytesOf(canned.stderr)),
      exited: Promise.resolve(canned.exitCode ?? 0),
      terminate: () => {
        this.terminated += 1
      },
    }
  }

  which(): string | null {
    return null
  }
}
