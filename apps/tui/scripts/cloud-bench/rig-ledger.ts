import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type LedgerEntry = { name: string; threadId: string; at: string }

export type Ledger = {
  add: (args: { name: string; threadId: string }) => Promise<void>
  entries: () => Promise<LedgerEntry[]>
  has: (name: string) => Promise<boolean>
}

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const isLedgerEntry = (value: unknown): value is LedgerEntry => {
  if (typeof value !== 'object' || value === null) return false
  return (
    'name' in value &&
    typeof value.name === 'string' &&
    'threadId' in value &&
    typeof value.threadId === 'string' &&
    'at' in value &&
    typeof value.at === 'string'
  )
}

const readEntries = async (file: string): Promise<LedgerEntry[]> => {
  const text = await readFile(file, 'utf8').catch((error: unknown) => {
    if (isMissingFile(error)) return null
    throw error
  })
  if (text === null) return []
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed) || !parsed.every(isLedgerEntry)) {
    throw new Error(`ledger ${file} is not a JSON array of { name, threadId, at } entries`)
  }
  return parsed
}

export function createLedger(args: { file: string }): Ledger {
  let pending: Promise<void> = Promise.resolve()

  const append = async (entry: LedgerEntry): Promise<void> => {
    const entries = await readEntries(args.file)
    await mkdir(dirname(args.file), { recursive: true })
    const staging = `${args.file}.${process.pid}.tmp`
    await writeFile(staging, `${JSON.stringify([...entries, entry], null, 2)}\n`)
    await rename(staging, args.file)
  }

  return {
    add: (entry) => {
      const next = pending.then(() => append({ ...entry, at: new Date().toISOString() }))
      pending = next.catch(() => undefined)
      return next
    },
    entries: async () => {
      await pending
      return readEntries(args.file)
    },
    has: async (name) => {
      await pending
      const entries = await readEntries(args.file)
      return entries.some((entry) => entry.name === name)
    },
  }
}
