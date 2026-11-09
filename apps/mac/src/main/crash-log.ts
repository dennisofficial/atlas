import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MAIN_LOG_PATH = join(homedir(), 'Library', 'Logs', 'Atlas', 'main.log')

export type StartupNotice = (args: { error: unknown; path: string }) => void | Promise<void>

export function formatLogEntry({
  label,
  error,
  now,
}: {
  label: string
  error: unknown
  now: Date
}): string {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return `${now.toISOString()} ${label}: ${detail}\n`
}

export function writeLog({
  label,
  error,
  path = MAIN_LOG_PATH,
}: {
  label: string
  error?: unknown
  path?: string
}): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, formatLogEntry({ label, error: error ?? '', now: new Date() }))
  } catch {
    return
  }
}

export function installCrashLogging(): void {
  process.on('uncaughtException', (error) => writeLog({ label: 'uncaughtException', error }))
  process.on('unhandledRejection', (error) => writeLog({ label: 'unhandledRejection', error }))
}

// A packaged app that dies before its window exists shows the user nothing at all, so a startup failure is a dialog, not only a log line.
export async function runLogged({
  start,
  notify,
  path = MAIN_LOG_PATH,
}: {
  start: () => Promise<void>
  notify?: StartupNotice | undefined
  path?: string
}): Promise<void> {
  installCrashLogging()
  writeLog({
    label: 'startup',
    error: `pid ${process.pid} ${process.platform}/${process.arch}`,
    path,
  })
  try {
    await start()
    writeLog({ label: 'started', path })
  } catch (error) {
    writeLog({ label: 'startup failed', error, path })
    await notify?.({ error, path })
    throw error
  }
}
