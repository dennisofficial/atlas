const MAX_RETRIES = 3
const MAX_CHAIN_DEPTH = 8
const COMMIT_FAILED_CODE = 'RUNTIME.TRANSACTION_COMMIT_FAILED'
const SQL_CONNECTION_KIND = 'sql_connection'
const CONNECTION_EXCEPTION_CLASS = '08'
const ADMIN_SHUTDOWN_STATES: ReadonlySet<string> = new Set(['57P01', '57P02', '57P03'])
const SOCKET_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT'])

const stringField = (error: unknown, field: string): string | undefined => {
  if (typeof error !== 'object' || error === null || !(field in error)) return undefined
  const value: unknown = Reflect.get(error, field)
  return typeof value === 'string' ? value : undefined
}

const causesOf = (error: unknown): unknown[] => {
  const links: unknown[] = []
  let link: unknown = error
  while (links.length < MAX_CHAIN_DEPTH && link instanceof Error && !links.includes(link)) {
    links.push(link)
    link = link.cause
  }
  return links
}

const isConnectionLossLink = (link: unknown): boolean => {
  if (stringField(link, 'kind') === SQL_CONNECTION_KIND) return true
  const code = stringField(link, 'code')
  if (code === undefined) return false
  return (
    code.startsWith(CONNECTION_EXCEPTION_CLASS) ||
    ADMIN_SHUTDOWN_STATES.has(code) ||
    SOCKET_CODES.has(code)
  )
}

export function isRetryableConnectionLoss(error: unknown): boolean {
  const links = causesOf(error)
  if (links.some((link) => stringField(link, 'code') === COMMIT_FAILED_CODE)) return false
  return links.some(isConnectionLossLink)
}

export async function retryOnConnectionLoss<T>(work: () => Promise<T>): Promise<T> {
  for (let retries = 0; ; retries += 1) {
    try {
      return await work()
    } catch (error) {
      if (retries >= MAX_RETRIES || !isRetryableConnectionLoss(error)) throw error
    }
  }
}
