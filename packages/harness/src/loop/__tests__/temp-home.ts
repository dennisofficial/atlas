import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TempHome = { home: string; discard: () => void }

export function createTempHome(): TempHome {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-loop-'))
  return {
    home: directory,
    discard: () => rmSync(directory, { recursive: true, force: true }),
  }
}
