import type { ExecState } from './engine'
import { demuxExecStream, EReadRecovery } from './frames'

const EXEC_POLL_MS = 50
const LOST_STREAM_POLL_MS = 1_000
const EXIT_INSPECTION_ATTEMPTS = 3

export const OUTPUT_STREAM_LOST_NOTE =
  "\natlas lost the connection to this process's output; the process is still running and can be killed, but nothing it prints from here will arrive\n"

export type TrackedExec = {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

// An exec attach stream is one long-lived HTTP connection to the daemon, and Docker Desktop's
// socket proxy kills those while the process they carry runs on — so a dead stream is an output
// loss until the daemon says the exec itself is over, and exit is settled by polling inspect.
export function trackExec(args: {
  stream: ReadableStream<Uint8Array>
  inspect: () => Promise<ExecState>
}): TrackedExec {
  const { inspect } = args
  let streamDied = false

  const inspectTolerantly = async (): Promise<ExecState> => {
    let failures = 0
    for (;;) {
      try {
        return await inspect()
      } catch (error) {
        failures += 1
        if (failures >= EXIT_INSPECTION_ATTEMPTS) throw error
        await new Promise((resolve) => setTimeout(resolve, EXEC_POLL_MS))
      }
    }
  }

  const demuxed = demuxExecStream({
    stream: args.stream,
    onReadFailure: async () => {
      const state = await inspectTolerantly()
      if (!state.running) return { kind: EReadRecovery.Ended }
      streamDied = true
      return {
        kind: EReadRecovery.LastWord,
        lastWord: new TextEncoder().encode(OUTPUT_STREAM_LOST_NOTE),
      }
    },
  })

  const exited = (async (): Promise<number> => {
    await demuxed.done.catch(() => undefined)
    for (;;) {
      const state = await inspectTolerantly()
      if (!state.running && state.exitCode !== null) return state.exitCode
      await new Promise((resolve) =>
        setTimeout(resolve, streamDied ? LOST_STREAM_POLL_MS : EXEC_POLL_MS),
      )
    }
  })()

  return { stdout: demuxed.stdout, stderr: demuxed.stderr, exited }
}
