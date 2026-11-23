import {
  EProcessOutcome,
  ProcessPort,
  type OomMemory,
  type ProcessHandle,
  type ProcessOutcome,
  type SpawnCommand,
} from '@dltech/atlas-core'

type Opened = {
  stdout: { stream: ReadableStream<Uint8Array>; push(text: string): void; close(): void }
  stderr: { stream: ReadableStream<Uint8Array>; push(text: string): void; close(): void }
}

const opened = (): Opened => {
  const encoder = new TextEncoder()
  let sink: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      sink = controller
    },
  })
  return {
    stdout: {
      stream,
      push: (text) => sink?.enqueue(encoder.encode(text)),
      close: () => {
        try {
          sink?.close()
        } catch {
          undefined
        }
      },
    },
    stderr: {
      stream: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
      push: () => undefined,
      close: () => undefined,
    },
  }
}

export type HandoverArgs = {
  adopt: boolean
  before?: string | undefined
  endsWith?: { kind: EProcessOutcome.OomKilled; memory: OomMemory; afterMs: number } | undefined
}

export class HandoverPort extends ProcessPort {
  readonly adopted: string[] = []
  readonly terminated: string[] = []

  constructor(private readonly args: HandoverArgs) {
    super()
  }

  spawn(_args: SpawnCommand): ProcessHandle {
    const io = opened()
    let settle: (outcome: ProcessOutcome) => void = () => undefined
    const outcome = new Promise<ProcessOutcome>((resolve) => {
      settle = resolve
    })
    const exit = (ended: ProcessOutcome): void => {
      settle(ended)
      io.stdout.close()
      io.stderr.close()
    }

    io.stdout.push(this.args.before ?? '')
    if (this.args.endsWith !== undefined) {
      const ending = this.args.endsWith
      setTimeout(() => exit({ kind: ending.kind, memory: ending.memory }), ending.afterMs)
    }

    return {
      stdout: io.stdout.stream,
      stderr: io.stderr.stream,
      exited: outcome.then((ended) => (ended.kind === EProcessOutcome.Exited ? ended.code : 0)),
      outcome,
      terminate: () => {
        this.terminated.push('terminated')
        exit({ kind: EProcessOutcome.Exited, code: 137 })
      },
      moveToBackground: async ({ shellId }) => {
        this.adopted.push(shellId)
        if (!this.args.adopt) return false
        exit({ kind: EProcessOutcome.Backgrounded, shellId })
        return true
      },
    }
  }

  which(_args: { command: string }): string | null {
    return 'bash'
  }
}
