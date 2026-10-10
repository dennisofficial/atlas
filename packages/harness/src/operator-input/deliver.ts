import type { AgentFileSystemPort, ProcessHandle, ProcessPort, ThreadId } from '@dltech/atlas-core'

import type { OperatorInputAnswerOutcome } from './port'

export const DELIVER_TIMEOUT_MS = 30_000
const STDERR_TAIL_MAX_CHARS = 200
const NO_CLOBBER_MARKER = /file exists|cannot overwrite existing file/i

function failureReason(args: { path: string; code: number; stderr: string }): string {
  const tail = args.stderr.trim()
  const detail = tail.length > 0 && tail.length < STDERR_TAIL_MAX_CHARS ? ` (${tail})` : ''
  if (NO_CLOBBER_MARKER.test(args.stderr)) {
    return `delivery to ${args.path} failed — a file already exists at that path and operator_input never overwrites. Delete it (rm), or pass a fresh path.${detail}`
  }
  return `delivery to ${args.path} failed (exit ${args.code})${detail}; use a writable FIFO or a new file path`
}

export type DeliverOperatorInputArgs = {
  path: string
  value: string
  threadId: ThreadId
  cwd: string
  signal: AbortSignal
}

export async function deliverOperatorInput(args: DeliverOperatorInputArgs & {
  files: AgentFileSystemPort
  processes: ProcessPort
  timeoutMs?: number
}): Promise<OperatorInputAnswerOutcome> {
  if (args.signal.aborted) return { ok: false, reason: 'operator input delivery cancelled; partial input may have reached the reader — restart the CLI with a fresh destination' }
  const spool = `/tmp/atlas-operator-input-${crypto.randomUUID()}`
  let process: ProcessHandle | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => process?.terminate()
  args.signal.addEventListener('abort', stop, { once: true })

  try {
    await args.files.writeFile({ path: spool, content: args.value, mode: 0o600, threadId: args.threadId })
    if (args.signal.aborted) return { ok: false, reason: 'operator input delivery cancelled; partial input may have reached the reader — restart the CLI with a fresh destination' }
    process = args.processes.spawn({
      cmd: ['sh', '-c', 'set -C; umask 077; cat "$1" > "$2"', 'sh', spool, args.path],
      cwd: args.cwd,
      threadId: args.threadId,
    })
    const stderr = new Response(process.stderr).text()
    const stdout = new Response(process.stdout).arrayBuffer()
    let timedOut = false
    timer = setTimeout(() => {
      timedOut = true
      stop()
    }, args.timeoutMs ?? DELIVER_TIMEOUT_MS)
    const code = await process.exited
    const [stderrText] = await Promise.all([stderr, stdout])
    if (args.signal.aborted) return { ok: false, reason: 'operator input delivery cancelled; partial input may have reached the reader — restart the CLI with a fresh destination' }
    if (timedOut) {
      return { ok: false, reason: `delivery to ${args.path} timed out; partial input may have reached the reader — restart the CLI with a fresh destination before asking again` }
    }
    if (code !== 0) {
      return { ok: false, reason: failureReason({ path: args.path, code, stderr: stderrText }) }
    }
    return { ok: true, bytes: Buffer.byteLength(args.value) }
  } catch {
    stop()
    return { ok: false, reason: `could not deliver operator input to ${args.path}` }
  } finally {
    clearTimeout(timer)
    args.signal.removeEventListener('abort', stop)
    await args.files.removeFile({ path: spool, threadId: args.threadId }).catch(() => undefined)
  }
}
