import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OWNER_ONLY = 0o600

export const writeAtomically = (args: { path: string; content: string }): void => {
  mkdirSync(dirname(args.path), { recursive: true })
  const staging = join(dirname(args.path), `.${randomBytes(8).toString('hex')}.tmp`)
  writeFileSync(staging, args.content, { mode: OWNER_ONLY })
  renameSync(staging, args.path)
}
