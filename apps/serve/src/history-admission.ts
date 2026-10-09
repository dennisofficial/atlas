import type { ThreadId } from '@dltech/atlas-core'
import type { MessageIntake } from '@dltech/atlas-harness'

enum EHold {
  History = 'history',
  Rotation = 'rotation',
}

const SUMMARISING = 'the history is being summarised — wait for it to finish'
const ROTATING = 'the session is rotating — wait for it to finish'

export function createHistoryAdmission(args: {
  threadId: () => ThreadId
  intake: MessageIntake | null
  unavailable: () => boolean
  relocating?: (() => boolean) | undefined
  refusal?: (() => string | undefined) | undefined
}) {
  let holder: EHold | null = null
  const assertAvailable = (): void => {
    if (holder === EHold.Rotation) throw new Error(ROTATING)
    if (holder === EHold.History) throw new Error(SUMMARISING)
  }
  const take = (taking: { kind: EHold; blocked: string | undefined }): (() => void) => {
    assertAvailable()
    const refusal = args.refusal?.()
    if (refusal !== undefined) throw new Error(refusal)
    if (taking.blocked !== undefined) throw new Error(taking.blocked)
    holder = taking.kind
    const release = args.intake?.hold({ threadId: args.threadId() })
    return () => {
      holder = null
      release?.()
      args.intake?.changed()
    }
  }
  return {
    held: () => holder !== null,
    assertAvailable,
    hold: (): (() => void) =>
      take({
        kind: EHold.History,
        blocked: args.unavailable()
          ? 'a turn or workspace handoff is running — wait before summarising history'
          : undefined,
      }),
    holdForRotation: (): (() => void) =>
      take({
        kind: EHold.Rotation,
        blocked: args.relocating?.() === true ? 'a workspace handoff is running — wait before rotating' : undefined,
      }),
  }
}
