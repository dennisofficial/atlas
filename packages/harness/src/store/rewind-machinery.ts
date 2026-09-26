import type { RewindCut, ThreadId } from '@dltech/atlas-core'

import type { RewindKill } from './rewind'

export type RewindRead = { reachable: boolean; kills: readonly RewindKill[] }

/**
 * Who answers for the processes a rewind would destroy. A local thread's creations live in this
 * process's registries; a cloud thread's live in the sandbox's. The port keeps `rewindThread`
 * one code path for both: `snapshot` prices the confirmation, `destroy` runs only after the
 * operator has confirmed. `reachable: false` means the machine holding the processes could not
 * be asked — the cut list is still complete (it comes from the log), but `running` is unknown.
 */
export abstract class RewindMachineryPort {
  /**
   * Set by the machine that owns the durable log (the cloud sandbox's), read by `rewindThread` to
   * skip its own store truncation: that machine truncates as part of `destroy`, so the kill and
   * the truncation are one request rather than a write racing a command.
   */
  readonly ownsDurableLog?: boolean

  abstract snapshot(args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
  }): Promise<RewindRead>
  abstract destroy(args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
    toSeq?: number | undefined
  }): Promise<void>
}
