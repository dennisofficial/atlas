import { resolve } from 'node:path'

import { exportHarnessDb } from '../src/migrate/export-harness-db'

function parseArgs({ argv }: { argv: string[] }): { db: string; home: string } {
  let db: string | undefined
  let home: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--db' && value !== undefined) {
      db = value
      index += 1
    } else if (flag === '--home' && value !== undefined) {
      home = value
      index += 1
    } else {
      throw new Error(`unrecognized argument: ${flag ?? ''}`)
    }
  }

  if (db === undefined || home === undefined) {
    throw new Error(
      'usage: bun packages/harness/scripts/export-harness-db.ts --db <path-to-harness.db> --home <target-atlas-home>',
    )
  }
  return { db, home }
}

const { db, home } = parseArgs({ argv: process.argv.slice(2) })

const summary = await exportHarnessDb({
  databaseUrl: `file:${resolve(db)}`,
  home: resolve(home),
})

console.log(`export complete: ${db} -> ${home}/sessions`)
console.log(`  sessions:        ${summary.sessions}`)
console.log(`  threads:         ${summary.threads}`)
console.log(`  events:          ${summary.events}`)
console.log(`  turns:           ${summary.turns}`)
console.log(`  malformed bodies: ${summary.malformedBodies}`)
console.log(`  orphaned agents: ${summary.orphanedAgents}`)
