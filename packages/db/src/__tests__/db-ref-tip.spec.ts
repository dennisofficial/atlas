import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MIGRATIONS_DIRECTORY } from '../migration-graph'

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

const dbRefHash = (): unknown =>
  Reflect.get(readJson(join(MIGRATIONS_DIRECTORY, 'refs', 'db.json')) as object, 'hash')

const contractStorageHash = (): unknown => {
  const contract = readJson(join(import.meta.dirname, '..', 'prisma', 'schema', 'contract.json'))
  return Reflect.get(Reflect.get(contract as object, 'storage') as object, 'storageHash')
}

describe('the db migration ref', () => {
  test('points at the emitted contract, so a deploy migrates to what the api expects', () => {
    expect(dbRefHash()).toBe(contractStorageHash())
  })
})
