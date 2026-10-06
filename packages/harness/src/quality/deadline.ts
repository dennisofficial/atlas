export type QualityDeadlineResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'deadline' }
  | { kind: 'aborted' }
  | { kind: 'failed'; error: unknown }

export function withQualityDeadline<T>({
  signal,
  deadlineMs,
  work,
}: {
  signal: AbortSignal
  deadlineMs: number
  work: (signal: AbortSignal) => Promise<T>
}): Promise<QualityDeadlineResult<T>> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })

  return new Promise((resolve) => {
    const controller = new AbortController()
    let settled = false

    const settle = (result: QualityDeadlineResult<T>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      if (result.kind !== 'completed') controller.abort()
      resolve(result)
    }
    const handleAbort = (): void => settle({ kind: 'aborted' })
    const timer = setTimeout(() => settle({ kind: 'deadline' }), deadlineMs)

    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve()
      .then(() => work(controller.signal))
      .then(
        (value) => settle({ kind: 'completed', value }),
        (error: unknown) => settle({ kind: 'failed', error }),
      )
  })
}
