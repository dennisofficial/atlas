// Compatibility shims for vitest `vi.*` APIs that `bun:test` does not provide.
// Import from `@dltech/bun-test-shims` instead of `vitest` where a spec needs
// one of these. Everything else (`vi.fn`, `vi.spyOn`, `vi.useFakeTimers`,
// `vi.mock`, …) already exists on `bun:test`'s own `vi` export — use that.
import { jest, vi } from 'bun:test'

// Flushes via setImmediate, not setTimeout: under fake timers a setTimeout(0)
// never fires, which would hang the flush. setImmediate is not timer-faked.
function nextRealTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

async function flushPendingWork(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await nextRealTurn()
}

// `vi.advanceTimersByTimeAsync` — vitest's version also flushes pending work
// between timer callbacks. Bun's advance is synchronous, so flush the real
// microtask/immediate queue around it for the same observable behavior.
export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  await flushPendingWork()
  vi.advanceTimersByTime(ms)
  await flushPendingWork()
}

// `vi.waitFor` — poll `callback` until it stops throwing or the timeout fires.
// Under fake timers the real clock is frozen, so poll by advancing the fake
// clock instead of awaiting real setTimeout (which would never fire).
const WAIT_FOR_REAL_TIMEOUT_MS = 2_000
const WAIT_FOR_FAKE_TURNS = 200
const WAIT_FOR_INTERVAL_MS = 20

async function retryFaked(assertion: () => void | Promise<void>): Promise<void> {
  let lastError: unknown
  for (let turn = 0; turn < WAIT_FOR_FAKE_TURNS; turn += 1) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
    }
    vi.advanceTimersByTime(WAIT_FOR_INTERVAL_MS)
    await nextRealTurn()
  }
  throw lastError
}

async function retryReal(
  assertion: () => void | Promise<void>,
  timeout: number,
  interval: number,
): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw lastError
}

export function waitFor(
  assertion: () => void | Promise<void>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const { timeout = WAIT_FOR_REAL_TIMEOUT_MS, interval = WAIT_FOR_INTERVAL_MS } = options
  return vi.isFakeTimers() ? retryFaked(assertion) : retryReal(assertion, timeout, interval)
}

// `vi.stubEnv` / `vi.unstubAllEnvs` — bun:test has no env stubbing; save and
// restore process.env entries directly.
const stubbedEnv = new Map<string, string | undefined>()

export function stubEnv(name: string, value: string | undefined): void {
  if (!stubbedEnv.has(name)) stubbedEnv.set(name, process.env[name])
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

export function unstubAllEnvs(): void {
  for (const [name, value] of stubbedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  stubbedEnv.clear()
}

// `vi.stubGlobal` / `vi.unstubAllGlobals` — save and restore globalThis slots.
const stubbedGlobals = new Map<string | symbol, { had: boolean; value: unknown }>()

export function stubGlobal(name: string | symbol, value: unknown): void {
  const globalScope = globalThis as Record<string | symbol, unknown>
  if (!stubbedGlobals.has(name)) {
    stubbedGlobals.set(name, {
      had: Object.hasOwn(globalScope, name),
      value: globalScope[name],
    })
  }
  globalScope[name] = value
}

export function unstubAllGlobals(): void {
  const globalScope = globalThis as Record<string | symbol, unknown>
  for (const [name, saved] of stubbedGlobals) {
    if (saved.had) globalScope[name] = saved.value
    else delete globalScope[name]
  }
  stubbedGlobals.clear()
}

// `vi.setConfig({ testTimeout })` — bun:test exposes it as `jest.setTimeout`.
export function setTestTimeout(ms: number): void {
  jest.setTimeout(ms)
}

// `vi.hoisted` — vitest evaluates the factory before imports are applied.
// bun:test hoists nothing; call sites must move the value to module scope
// themselves. This export exists only as a typed passthrough for trivial cases.
export function hoisted<T>(factory: () => T): T {
  return factory()
}
