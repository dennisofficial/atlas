import pg from 'pg'
import { SANDBOX_PRINCIPAL_REVOKED_CHANNEL } from './sandbox-principal-notify'

export const PRINCIPAL_WATCH_APPLICATION_NAME = 'atlas-sandbox-principal-watch'

const RETRY_BASE_MS = 250
const RETRY_CAP_MS = 5_000

const SESSION_SETTINGS = ['SET statement_timeout = 0', 'SET lock_timeout = 0']

export type PrincipalWatch = {
  close(): Promise<void>
}

/**
 * A revocation reaches the instance that wrote it through its own cache call; every other
 * instance hears it here. Clearing on every (re)connect is what makes a dropped listener safe:
 * anything published while it was down was missed, and the 30s TTL alone would let a revoked
 * token keep working.
 */
export const startPrincipalWatch = (args: {
  url: string
  onRevoked(payload: string): void
  onConnected(): void
  createClient?: (() => pg.Client) | undefined
  log?: ((line: string, error?: unknown) => void) | undefined
}): PrincipalWatch => {
  let closed = false
  let client: pg.Client | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let loop: Promise<void> | undefined
  let again = false

  const open = (): pg.Client =>
    args.createClient?.() ??
    new pg.Client({
      connectionString: args.url,
      keepAlive: true,
      application_name: PRINCIPAL_WATCH_APPLICATION_NAME,
    })

  const logError = (line: string, error?: unknown): void => {
    args.log?.(line, error)
  }

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== undefined) return
    const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_CAP_MS)
    failures += 1
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void pump()
    }, delay)
  }

  const dropClient = async (target: pg.Client | undefined): Promise<void> => {
    if (target === undefined) return
    target.removeAllListeners()
    await target.end().catch(() => undefined)
  }

  const fail = (owner: pg.Client, line: string, error?: unknown): void => {
    if (closed || client !== owner) return
    logError(line, error)
    client = undefined
    void dropClient(owner)
    scheduleRetry()
  }

  const arm = async (): Promise<void> => {
    const owner = open()
    client = owner
    owner.on('error', (error: unknown) => fail(owner, 'principal watch connection lost', error))
    owner.on('end', () => fail(owner, 'principal watch connection ended'))
    try {
      await owner.connect()
      for (const statement of SESSION_SETTINGS) await owner.query(statement)
      await owner.query(`LISTEN ${SANDBOX_PRINCIPAL_REVOKED_CHANNEL}`)
      owner.on('notification', (message: pg.Notification) => {
        if (message.channel !== SANDBOX_PRINCIPAL_REVOKED_CHANNEL) return
        args.onRevoked(message.payload ?? '')
      })
      failures = 0
      args.onConnected()
    } catch (error) {
      fail(owner, 'principal watch failed', error)
    }
  }

  const step = async (): Promise<void> => {
    const previous = client
    client = undefined
    await dropClient(previous)
    if (closed) return
    await arm()
  }

  const drain = async (): Promise<void> => {
    while (again) {
      again = false
      await step().catch((error: unknown) => logError('principal watch step failed', error))
    }
    loop = undefined
  }

  const pump = (): Promise<void> => {
    again = true
    loop ??= drain()
    return loop
  }

  void pump()

  return {
    async close() {
      closed = true
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      await pump()
    },
  }
}
