import { databaseUrl, laneUrl } from './lane'

const RUN_PREFIX = 'atlas_test_run_'

export function runDatabaseName(pid: number = process.pid): string {
  return `${RUN_PREFIX}${pid}`
}

export function runPidOf(name: string): number | undefined {
  if (!name.startsWith(RUN_PREFIX)) return undefined
  const pid = Number(name.slice(RUN_PREFIX.length))
  return Number.isInteger(pid) ? pid : undefined
}

export function assignTestDatabaseUrl(): string {
  const url = databaseUrl({ lane: laneUrl(), name: runDatabaseName() })
  process.env.DATABASE_URL = url
  return url
}
