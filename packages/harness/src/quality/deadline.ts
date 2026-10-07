export const QUALITY_SETTLEMENT_GRACE_MS = 10

export class QualityDeadlineError extends Error {
  constructor(readonly budgetMs: number) {
    super(`review exceeded ${budgetMs}ms`)
    this.name = 'QualityDeadlineError'
  }
}

export type QualityBudget = {
  readonly signal: AbortSignal
  readonly deadlineAt: number
  readonly budgetMs: number
  dispose: () => void
}

export type QualityDeadlineResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'deadline'; error: QualityDeadlineError }
  | { kind: 'aborted' }
  | { kind: 'failed'; error: unknown }

export type QualityReviewSettlement<T> =
  | { kind: 'completed'; value: T; afterDeadline: boolean }
  | Exclude<QualityDeadlineResult<T>, { kind: 'completed' }>

export const deadlineErrorOf = (signal: AbortSignal): QualityDeadlineError | undefined =>
  signal.reason instanceof QualityDeadlineError ? signal.reason : undefined

const abortResultOf = (signal: AbortSignal): { kind: 'deadline'; error: QualityDeadlineError } | { kind: 'aborted' } => {
  const error = deadlineErrorOf(signal)
  return error === undefined ? { kind: 'aborted' } : { kind: 'deadline', error }
}

export function createQualityBudget({
  signal,
  budgetMs,
  now = Date.now,
}: {
  signal: AbortSignal
  budgetMs: number
  now?: () => number
}): QualityBudget {
  const controller = new AbortController()
  const handleOperatorAbort = (): void => controller.abort(signal.reason)
  let timer: ReturnType<typeof setTimeout> | undefined

  if (signal.aborted) {
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', handleOperatorAbort, { once: true })
    timer = setTimeout(() => controller.abort(new QualityDeadlineError(budgetMs)), budgetMs)
  }

  return {
    signal: controller.signal,
    deadlineAt: now() + budgetMs,
    budgetMs,
    dispose: () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', handleOperatorAbort)
    },
  }
}

export function settleUnderBudget<T>({
  signal,
  work,
}: {
  signal: AbortSignal
  work: (signal: AbortSignal) => Promise<T>
}): Promise<QualityDeadlineResult<T>> {
  if (signal.aborted) return Promise.resolve(abortResultOf(signal))

  return new Promise((resolve) => {
    let settled = false
    const settle = (result: QualityDeadlineResult<T>): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      resolve(result)
    }
    const handleAbort = (): void => settle(abortResultOf(signal))

    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve()
      .then(() => work(signal))
      .then(
        (value) => settle({ kind: 'completed', value }),
        (error: unknown) => settle({ kind: 'failed', error }),
      )
  })
}

export function settleReview<T>({
  budget,
  work,
  graceMs = QUALITY_SETTLEMENT_GRACE_MS,
}: {
  budget: QualityBudget
  work: (signal: AbortSignal) => Promise<T>
  graceMs?: number
}): Promise<QualityReviewSettlement<T>> {
  const { signal } = budget
  if (signal.aborted) return Promise.resolve(abortResultOf(signal))

  return new Promise((resolve) => {
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const settle = (result: QualityReviewSettlement<T>): void => {
      if (settled) return
      settled = true
      clearTimeout(graceTimer)
      signal.removeEventListener('abort', handleAbort)
      resolve(result)
    }
    const handleAbort = (): void => {
      const error = deadlineErrorOf(signal)
      if (error === undefined) return settle({ kind: 'aborted' })
      graceTimer = setTimeout(() => settle({ kind: 'deadline', error }), graceMs)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve()
      .then(() => work(signal))
      .then(
        (value) => settle({ kind: 'completed', value, afterDeadline: deadlineErrorOf(signal) !== undefined }),
        (error: unknown) => {
          const deadline = deadlineErrorOf(signal)
          settle(deadline === undefined ? { kind: 'failed', error } : { kind: 'deadline', error: deadline })
        },
      )
  })
}
