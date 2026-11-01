import type { ProcessHandle, ProcessPort, ThreadId } from '@dltech/atlas-core'

export const CHECKOUT_PROBE_TIMEOUT_MS = 1_000

const NOT_ON_BRANCH_EXIT_CODE = 1
const NOT_A_REPOSITORY_EXIT_CODE = 128

export type ObservedCheckout = { branch: string | null; detached: boolean }

const discard = (stream: ReadableStream<Uint8Array>): Promise<void> =>
  new Response(stream).text().then(() => undefined)

export async function probeCheckout({
  process,
  cwd,
  threadId,
  timeoutMs = CHECKOUT_PROBE_TIMEOUT_MS,
}: {
  process: ProcessPort
  cwd: string
  threadId: ThreadId
  timeoutMs?: number
}): Promise<ObservedCheckout | undefined> {
  let handle: ProcessHandle | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const spawned = process.spawn({
      cmd: ['git', 'symbolic-ref', '--short', '-q', 'HEAD'],
      cwd,
      threadId,
    })
    handle = spawned
    const collected = Promise.all([
      new Response(spawned.stdout).text(),
      spawned.exited,
      discard(spawned.stderr),
    ])
    collected.catch(() => undefined)
    const expired = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs)
    })
    const finished = await Promise.race([collected, expired])
    if (finished === undefined) {
      spawned.terminate()
      return undefined
    }
    const [stdout, exitCode] = finished
    if (exitCode === 0) {
      const branch = stdout.trim()
      return branch === '' ? undefined : { branch, detached: false }
    }
    if (exitCode === NOT_ON_BRANCH_EXIT_CODE) return { branch: null, detached: true }
    if (exitCode === NOT_A_REPOSITORY_EXIT_CODE) return { branch: null, detached: false }
    return undefined
  } catch {
    handle?.terminate()
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
