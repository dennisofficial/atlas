import { poolMaxOf } from './pool'

const CONNECTION_TERMINATED = 'Connection terminated'
const COMMIT_FAILED = 'Transaction commit failed'

export function isRetryableConnectionLoss(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message.includes(COMMIT_FAILED)) return false
  if (error.message.includes(CONNECTION_TERMINATED)) return true
  return error.cause instanceof Error && error.cause.message.includes(CONNECTION_TERMINATED)
}

export async function retryOnConnectionLoss<T>(work: () => Promise<T>): Promise<T> {
  const attempts = poolMaxOf(process.env.DATABASE_POOL_MAX)
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work()
    } catch (error) {
      if (!isRetryableConnectionLoss(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
