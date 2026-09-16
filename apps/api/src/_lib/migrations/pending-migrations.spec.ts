import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pendingMigrations, shippedMigrationNames } from './pending-migrations'

describe('pendingMigrations', () => {
  it('names what the image ships and the database has not run', () => {
    expect(
      pendingMigrations({
        shipped: ['20260914174234_init', '20260915230000_secret_version'],
        applied: ['20260914174234_init'],
      }),
    ).toEqual(['20260915230000_secret_version'])
  })

  it('is empty when the database is level with the image', () => {
    expect(
      pendingMigrations({ shipped: ['a', 'b'], applied: ['b', 'a'] }),
    ).toEqual([])
  })

  it('is empty when the database is ahead, which is an ordinary deploy window', () => {
    expect(pendingMigrations({ shipped: ['a'], applied: ['a', 'b'] })).toEqual([])
  })

  it('treats an unmigrated database as every migration pending', () => {
    expect(pendingMigrations({ shipped: ['a', 'b'], applied: [] })).toEqual(['a', 'b'])
  })
})

describe('shippedMigrationNames', () => {
  let directory: string | undefined

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
    directory = undefined
  })

  it('reads the directory names, ignoring the lock file', () => {
    directory = mkdtempSync(join(tmpdir(), 'atlas-migrations-'))
    mkdirSync(join(directory, '20260101000000_b'))
    mkdirSync(join(directory, '20250101000000_a'))
    writeFileSync(join(directory, 'migration_lock.toml'), 'provider = "postgresql"')

    expect(shippedMigrationNames({ directory })).toEqual([
      '20250101000000_a',
      '20260101000000_b',
    ])
  })
})
