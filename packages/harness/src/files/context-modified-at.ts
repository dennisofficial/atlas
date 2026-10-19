import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MAX_SCANNED_ENTRIES = 1000

const modifiedAt = (path: string): number => {
  try {
    return lstatSync(path).mtimeMs
  } catch {
    return 0
  }
}

export function contextModifiedAt(args: { context: string }): number {
  let names: string[]
  try {
    names = readdirSync(args.context, { recursive: true, encoding: 'utf8' })
  } catch {
    return 0
  }
  let newest = modifiedAt(args.context)
  for (const name of names.slice(0, MAX_SCANNED_ENTRIES)) newest = Math.max(newest, modifiedAt(join(args.context, name)))
  return newest
}
