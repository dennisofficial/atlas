import { writeFileAtomic } from './identity'
import type { ShellStatus } from './protocol'

export type StatusWriter = {
  current: () => ShellStatus
  update: (patch: Partial<ShellStatus>) => Promise<void>
}

export function createStatusWriter({ path, initial }: { path: string; initial: ShellStatus }): StatusWriter {
  let status = initial
  let chain: Promise<void> = Promise.resolve()

  return {
    current: () => status,
    update: (patch) => {
      status = { ...status, ...patch, updatedAt: Date.now() }
      const snapshot = status
      const write = chain.then(() => writeFileAtomic({ path, data: JSON.stringify(snapshot), mode: 0o600 }))
      chain = write.catch(() => undefined)
      return write
    },
  }
}
