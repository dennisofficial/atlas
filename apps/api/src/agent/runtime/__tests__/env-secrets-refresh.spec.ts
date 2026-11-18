import { describe, expect, it } from 'bun:test'

import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import type { EnvSecretsSource } from '../../config/env-secrets'
import { envSecretsRefresher } from '../env-secrets-refresh'
import { exportEnvSecretsOf } from '../env-secrets'
import { ShellEnvCell } from '../shell-env'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const cellOf = (): ShellEnvCell =>
  new ShellEnvCell({ identityOf: async () => ({ name: 'n', email: 'e' }) })

const sourceOf = (read: EnvSecretsSource['read']): EnvSecretsSource => ({ read })

const refresherOf = (args: {
  source?: EnvSecretsSource | undefined
  cell: ShellEnvCell
  log?: LogPort | undefined
}) =>
  envSecretsRefresher({
    cell: args.cell,
    userId: 'usr-1',
    projectId: 'prj-1',
    sessionId: 'ses-1',
    ...(args.source === undefined ? {} : { source: args.source }),
    ...(args.log === undefined ? {} : { log: args.log }),
  })

describe('envSecretsRefresher', () => {
  it('puts what the source exported into the shell env cell', async () => {
    const cell = cellOf()
    const seen: unknown[] = []
    const refresher = refresherOf({
      cell,
      source: sourceOf(async (lookup) => {
        seen.push(lookup)
        return exportEnvSecretsOf({ user: [], project: [{ name: 'API_KEY', value: 'k' }] })
      }),
    })

    await refresher()

    expect(seen).toEqual([{ userId: 'usr-1', projectId: 'prj-1' }])
    expect(cell.current()).toEqual({ API_KEY: 'k' })
    expect(cell.exportedSecretNames()).toEqual(['API_KEY'])
  })

  it('keeps the previous set and logs without a value when the read fails', async () => {
    const cell = cellOf()
    cell.setSecrets(exportEnvSecretsOf({ user: [{ name: 'API_KEY', value: 'old' }], project: [] }))
    const log = new RecordingLog()
    const refresher = refresherOf({
      cell,
      source: sourceOf(async () => {
        throw new Error('database is unreachable')
      }),
      log,
    })

    await refresher()

    expect(cell.current()).toEqual({ API_KEY: 'old' })
    expect(log.entries[0]?.message).toContain('shells keep the previous set')
    expect(log.entries[0]?.error).toContain('database is unreachable')
  })

  it('does nothing when the session has no cloud secrets source', async () => {
    const cell = cellOf()

    await refresherOf({ cell })()

    expect(cell.current()).toEqual({})
  })
})
