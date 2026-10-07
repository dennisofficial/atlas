import { describe, expect, it } from 'bun:test'

import { QualityDeadlineError, createQualityBudget, settleReview, settleUnderBudget } from '../deadline'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('createQualityBudget', () => {
  it('aborts its signal with a typed deadline error and stamps an absolute deadline', async () => {
    const before = Date.now()
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 15 })
    expect(budget.deadlineAt).toBeGreaterThanOrEqual(before + 15)
    await sleep(40)
    expect(budget.signal.aborted).toBe(true)
    expect(budget.signal.reason).toBeInstanceOf(QualityDeadlineError)
    budget.dispose()
  })

  it('forwards an operator abort without a deadline reason', () => {
    const operator = new AbortController()
    const budget = createQualityBudget({ signal: operator.signal, budgetMs: 500 })
    operator.abort()
    expect(budget.signal.aborted).toBe(true)
    expect(budget.signal.reason).not.toBeInstanceOf(QualityDeadlineError)
    budget.dispose()
  })

  it('does not abort after dispose', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 10 })
    budget.dispose()
    await sleep(30)
    expect(budget.signal.aborted).toBe(false)
  })
})

describe('settleUnderBudget', () => {
  it('returns the completed value', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 100 })
    expect(await settleUnderBudget({ signal: budget.signal, work: async () => 7 })).toEqual({ kind: 'completed', value: 7 })
    budget.dispose()
  })

  it('settles as deadline with the typed error when the work ignores its signal', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 15 })
    const result = await settleUnderBudget({
      signal: budget.signal,
      work: async () => {
        await sleep(60)
        return 'late'
      },
    })
    expect(result.kind).toBe('deadline')
    await sleep(60)
    budget.dispose()
  })

  it('settles as aborted for an operator abort and never starts work on a dead signal', async () => {
    const operator = new AbortController()
    const budget = createQualityBudget({ signal: operator.signal, budgetMs: 500 })
    const pending = settleUnderBudget({ signal: budget.signal, work: () => new Promise<never>(() => {}) })
    operator.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
    let started = false
    expect(await settleUnderBudget({ signal: budget.signal, work: async () => (started = true) })).toEqual({ kind: 'aborted' })
    expect(started).toBe(false)
    budget.dispose()
  })

  it('reports a rejection as failed', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 100 })
    const result = await settleUnderBudget({
      signal: budget.signal,
      work: async () => {
        throw new Error('boom')
      },
    })
    expect(result.kind).toBe('failed')
    budget.dispose()
  })
})

describe('settleReview', () => {
  it('lets a cooperative review finish inside the grace window and flags it as after the deadline', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 10 })
    const result = await settleReview({
      budget,
      graceMs: 50,
      work: (signal) => new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve('records'))),
    })
    expect(result).toEqual({ kind: 'completed', value: 'records', afterDeadline: true })
    budget.dispose()
  })

  it('falls back to deadline once the grace window passes for a review that ignores its signal', async () => {
    const budget = createQualityBudget({ signal: new AbortController().signal, budgetMs: 10 })
    const started = Date.now()
    const result = await settleReview({ budget, graceMs: 15, work: () => new Promise<never>(() => {}) })
    expect(result.kind).toBe('deadline')
    expect(Date.now() - started).toBeLessThan(200)
    budget.dispose()
  })

  it('does not wait out the grace window for an operator abort', async () => {
    const operator = new AbortController()
    const budget = createQualityBudget({ signal: operator.signal, budgetMs: 500 })
    const pending = settleReview({ budget, graceMs: 500, work: () => new Promise<never>(() => {}) })
    operator.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
    budget.dispose()
  })
})
