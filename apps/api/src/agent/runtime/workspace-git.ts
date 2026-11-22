import { EProcessOutcome, outcomeOf, type ProcessPort } from '@dltech/atlas-core'

export const CLONE_TIMEOUT_MS = 10 * 60_000

type RunOutcome = {
  ok: boolean
  output: string
  interrupted?: boolean
  detached?: boolean
  unknownExit?: boolean
}

export const branchFlagsOf = (branch: string | null): string[] =>
  branch === null || branch === '' ? [] : ['--branch', branch]

const readOutput = async (args: {
  stream: ReadableStream<Uint8Array>
  onOutput?: ((text: string) => void) | undefined
}): Promise<string> => {
  const decoder = new TextDecoder()
  const reader = args.stream.getReader()
  let output = ''
  const take = (text: string): void => {
    if (text === '') return
    output += text
    args.onOutput?.(text)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    take(decoder.decode(value, { stream: true }))
  }
  take(decoder.decode())
  return output
}

export const run = async (args: {
  processes: ProcessPort
  cmd: readonly string[]
  cwd: string
  timeoutMs: number
  signal?: AbortSignal | undefined
  env?: Record<string, string> | undefined
  onOutput?: ((text: string) => void) | undefined
}): Promise<RunOutcome> => {
  const handle = args.processes.spawn({
    cmd: args.cmd,
    cwd: args.cwd,
    ...(args.env === undefined ? {} : { env: args.env }),
  })
  const terminate = (): void => handle.terminate()
  const timer = setTimeout(terminate, args.timeoutMs)
  args.signal?.addEventListener('abort', terminate, { once: true })
  if (args.signal?.aborted === true) terminate()
  try {
    const [output, outcome] = await Promise.all([
      readOutput({ stream: handle.stdout, onOutput: args.onOutput }),
      outcomeOf(handle),
    ])
    if (outcome.kind === EProcessOutcome.Failed) {
      return { ok: false, output: `${output}${outcome.message}`, unknownExit: true }
    }
    if (outcome.kind === EProcessOutcome.Interrupted) {
      return { ok: false, output, interrupted: true }
    }
    const code = outcome.kind === EProcessOutcome.Exited ? outcome.code : null
    // 124 is a timeout and 130 a cancel: both are reported by the host that gave up watching, so
    // the script may well still be running on the pod
    const detached = code === 124 || code === 130
    return { ok: code === 0, output, ...(detached ? { detached: true } : {}) }
  } finally {
    clearTimeout(timer)
    args.signal?.removeEventListener('abort', terminate)
  }
}
