import { describe, expect, it } from 'bun:test'
import { isRetryableConnectionLoss, retryOnConnectionLoss } from '../connection-retry'

const withFields = (message: string, fields: Record<string, unknown>, cause?: unknown): Error =>
  Object.assign(new Error(message, cause === undefined ? undefined : { cause }), fields)

const sqlConnectionError = (cause?: unknown): Error =>
  withFields('Connection terminated unexpectedly', { kind: 'sql_connection' }, cause)

const commitFailed = (cause: unknown): Error =>
  withFields('Transaction commit failed', { code: 'RUNTIME.TRANSACTION_COMMIT_FAILED' }, cause)

describe('isRetryableConnectionLoss', () => {
  it.each(['57P01', '57P02', '57P03', '08000', '08003', '08006'])('retries sqlstate %s', (code) => {
    expect(isRetryableConnectionLoss(withFields('x', { code }))).toBe(true)
  })

  it.each(['ECONNRESET', 'EPIPE', 'ETIMEDOUT'])('retries socket code %s', (code) => {
    expect(isRetryableConnectionLoss(withFields('x', { code }))).toBe(true)
  })

  it('retries the connection error the Prisma runtime raises for a dropped link', () => {
    expect(isRetryableConnectionLoss(sqlConnectionError(new Error('x')))).toBe(true)
  })

  it('retries a rollback failure whose cause is a dropped link', () => {
    const rollback = withFields(
      'Transaction rollback failed after callback error',
      { code: 'RUNTIME.TRANSACTION_ROLLBACK_FAILED' },
      sqlConnectionError(),
    )
    expect(isRetryableConnectionLoss(rollback)).toBe(true)
  })

  it('does not retry from message text alone', () => {
    expect(isRetryableConnectionLoss(new Error('Connection terminated unexpectedly'))).toBe(false)
    expect(isRetryableConnectionLoss(new Error('session terminated'))).toBe(false)
  })

  it('does not retry a constraint violation or a bad query', () => {
    expect(isRetryableConnectionLoss(withFields('dup', { code: '23505' }))).toBe(false)
    expect(isRetryableConnectionLoss(withFields('syntax', { code: '42601' }))).toBe(false)
  })

  it('never retries a failed commit, even when its cause is a dropped link', () => {
    expect(isRetryableConnectionLoss(commitFailed(sqlConnectionError()))).toBe(false)
    expect(isRetryableConnectionLoss(commitFailed(withFields('x', { code: '57P01' })))).toBe(false)
  })

  it('finds the marker on a nested cause', () => {
    const wrapped = new Error('outer', { cause: new Error('mid', { cause: sqlConnectionError() }) })
    expect(isRetryableConnectionLoss(wrapped)).toBe(true)
  })

  it('survives a cyclic cause chain', () => {
    const loop = new Error('loop')
    loop.cause = loop
    expect(isRetryableConnectionLoss(loop)).toBe(false)
  })

  it('ignores non-errors', () => {
    expect(isRetryableConnectionLoss('ECONNRESET')).toBe(false)
    expect(isRetryableConnectionLoss(undefined)).toBe(false)
  })
})

describe('retryOnConnectionLoss', () => {
  const dropped = () => withFields('x', { code: '57P01' })

  it('retries at most three times, then throws the last failure', async () => {
    let calls = 0
    const failure = dropped()
    const run = retryOnConnectionLoss(async () => {
      calls += 1
      throw failure
    })
    await expect(run).rejects.toBe(failure)
    expect(calls).toBe(4)
  })

  it('stops as soon as the work succeeds', async () => {
    let calls = 0
    const result = await retryOnConnectionLoss(async () => {
      calls += 1
      if (calls < 3) throw dropped()
      return 'done'
    })
    expect(result).toBe('done')
    expect(calls).toBe(3)
  })

  it('does not retry an error without structure', async () => {
    let calls = 0
    const run = retryOnConnectionLoss(async () => {
      calls += 1
      throw new Error('Connection terminated unexpectedly')
    })
    await expect(run).rejects.toThrow('Connection terminated')
    expect(calls).toBe(1)
  })
})
