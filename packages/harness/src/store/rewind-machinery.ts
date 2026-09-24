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
  abstract snapshot(args: {
    cuts: readonly RewindCut[]
    threadId: ThreadId
  }): Promise<RewindRead>
  abstract destroy(args: { cuts: readonly RewindCut[]; threadId: ThreadId }): Promise<void>
}
