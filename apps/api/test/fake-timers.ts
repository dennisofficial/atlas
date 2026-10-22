import { vi } from 'bun:test'

const MICROTASK_TURNS = 5
const WAIT_FOR_TURNS = 200
const WAIT_FOR_INTERVAL_MS = 20
const WAIT_FOR_REAL_TIMEOUT_MS = 2_000

function nextRealTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function flushPendingWork(): Promise<void> {
  for (let turn = 0; turn < MICROTASK_TURNS; turn += 1) await nextRealTurn()
}

export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  await flushPendingWork()
  vi.advanceTimersByTime(ms)
  await flushPendingWork()
}

async function retryFaked(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown
  for (let turn = 0; turn < WAIT_FOR_TURNS; turn += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      vi.advanceTimersByTime(WAIT_FOR_INTERVAL_MS)
      await nextRealTurn()
    }
  }
  throw lastError
}

async function retryReal(assertion: () => void | Promise<void>): Promise<void> {
  const deadline = Date.now() + WAIT_FOR_REAL_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_INTERVAL_MS))
    }
  }
  throw lastError
}

export function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  return vi.isFakeTimers() ? retryFaked(assertion) : retryReal(assertion)
}
