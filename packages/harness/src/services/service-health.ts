import type { ProcessPort, ThreadId } from '@dltech/atlas-core'

export const READY_BUDGET_MS = 60_000
export const READY_INTERVAL_MS = 500

export type ReadyTiming = {
  budgetMs?: number | undefined
  intervalMs?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  now?: (() => number) | undefined
}

export async function probeService({
  processes,
  threadId,
  port,
  health,
}: {
  processes: ProcessPort
  threadId: ThreadId
  port: number
  health?: string | undefined
}): Promise<boolean> {
  const cmd =
    health === undefined
      ? ['bash', '-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`]
      : ['curl', '-fsS', '-o', '/dev/null', '--max-time', '2', `http://127.0.0.1:${port}${health}`]
  try {
    const handle = processes.spawn({ cmd, cwd: '/', threadId })
    return (await handle.exited) === 0
  } catch {
    return false
  }
}

export async function awaitReady({
  probe,
  alive,
  timing,
}: {
  probe: () => Promise<boolean>
  alive: () => boolean
  timing?: ReadyTiming | undefined
}): Promise<{ ready: true } | { ready: false; reason: string }> {
  const budgetMs = timing?.budgetMs ?? READY_BUDGET_MS
  const intervalMs = timing?.intervalMs ?? READY_INTERVAL_MS
  const sleep = timing?.sleep ?? ((ms: number) => Bun.sleep(ms))
  const now = timing?.now ?? Date.now
  const deadline = now() + budgetMs

  for (;;) {
    if (await probe()) return { ready: true }
    if (!alive()) return { ready: false, reason: 'the service is not running' }
    if (now() >= deadline) {
      return { ready: false, reason: `not accepting connections after ${budgetMs / 1000}s` }
    }
    await sleep(intervalMs)
  }
}
