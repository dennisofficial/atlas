import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations', 'app')

type Step = { sql: string; params?: unknown[] }
type Operation = { execute: Step[] }

function opsFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'refs')
    .map((entry) => join(MIGRATIONS_DIR, entry.name, 'ops.json'))
    .sort()
}

export function migrationSetHash(): string {
  const hash = createHash('sha256')
  for (const file of opsFiles()) hash.update(readFileSync(file))
  return hash.digest('hex').slice(0, 12)
}

export async function applyMigrations(client: pg.Client): Promise<void> {
  for (const file of opsFiles()) {
    const operations: Operation[] = JSON.parse(readFileSync(file, 'utf8'))
    for (const operation of operations) {
      for (const step of operation.execute) await client.query(step.sql, step.params ?? [])
    }
  }
}
