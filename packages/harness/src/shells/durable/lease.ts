import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readTextFile } from './identity'
import { LEASE_DIR, LEASE_SUFFIX } from './protocol'

export type LeaseTracker = {
  touch: () => void
  scan: () => Promise<void>
  lastTouchAt: () => number
}

export function createLeaseTracker({ shellDir, startedAt }: { shellDir: string; startedAt: number }): LeaseTracker {
  let lastTouch = startedAt
  const seen = new Map<string, string>()

  return {
    touch: () => {
      lastTouch = Date.now()
    },
    lastTouchAt: () => lastTouch,
    scan: async () => {
      const directory = join(shellDir, LEASE_DIR)
      const names = await readdir(directory).catch(() => [])
      const present = new Set<string>()
      for (const name of names) {
        if (!name.endsWith(LEASE_SUFFIX)) continue
        present.add(name)
        const contents = await readTextFile({ path: join(directory, name) })
        if (!contents.ok) continue
        const sequence = contents.value.trim()
        if (seen.get(name) === sequence) continue
        seen.set(name, sequence)
        lastTouch = Date.now()
      }
      for (const name of [...seen.keys()]) if (!present.has(name)) seen.delete(name)
    },
  }
}
