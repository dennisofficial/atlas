import type { Event, EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { PendingSaid } from '../pending'
import type { RewindMachineryPort } from '../store/rewind-machinery'
import { rewindThread } from '../store/rewind'
import type { ThreadStorePort } from '../store/thread-store'

export enum EUndo {
  Restored = 'restored',
  Refused = 'refused',
  Nothing = 'nothing',
}

export type Undo =
  | { type: EUndo.Restored; said: PendingSaid }
  | { type: EUndo.Refused; reason: string }
  | { type: EUndo.Nothing }

type Said = Extract<Event, { type: 'user-said' }>

const wasSaid = (event: Event): event is Said => event.type === 'user-said'

export async function undoTurn(args: {
  log: EventLogPort
  threads: ThreadStorePort
  machinery: RewindMachineryPort
  threadId: ThreadId
}): Promise<Undo> {
  const { log, threads, machinery, threadId } = args

  const said = (await log.readOwn({ threadId })).findLast(wasSaid)
  if (said === undefined) return { type: EUndo.Nothing }

  const rewound = await rewindThread({
    log,
    threads,
    machinery,
    threadId,
    toSeq: said.seq - 1,
  })
  if (!rewound.ok) {
    if ('needsConfirmation' in rewound) {
      return {
        type: EUndo.Refused,
        reason: 'undoing this turn would destroy work it started — rewind past it with /rewind to confirm',
      }
    }
    return { type: EUndo.Refused, reason: rewound.reason }
  }

  return { type: EUndo.Restored, said: { text: said.text, images: said.images ?? [] } }
}
