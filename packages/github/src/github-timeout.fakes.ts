import { vi } from 'bun:test'

// Node drives AbortSignal.timeout from an internal timer that fake timers cannot
// advance, so specs swap in a signal driven by the (fakeable) global setTimeout.
export const stubAbortSignalTimeout = (): { requestedMs: number[] } => {
  const requestedMs: number[] = []
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    requestedMs.push(ms)
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    }, ms)
    return controller.signal
  })
  return { requestedMs }
}

export const hangingFetch = (_url: unknown, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
