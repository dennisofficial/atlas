import type { ThreadId } from '@dltech/atlas-core'

import type { OpenChild } from './crew/open-children'
import { adoptChildrenOf, settleCrashedOf } from './held-runner'
import type { HeldSessionDeps } from './held-session-deps'
import { ETakeoverLap, type TakeOver } from './held-takeover'
import type { SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export const settleAndAdoptOf = async (args: {
  crew: { adoptAll(children: readonly OpenChild[]): Promise<void> }
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
  threadId: ThreadId
}): Promise<void> => {
  await settleCrashedOf(args)
  await args.crew.adoptAll(await adoptChildrenOf(args))
}

export const runTurnPrelude = async (args: {
  takeOver: Pick<TakeOver, 'lapped'>
  settle: () => Promise<void>
  commands: () => Promise<void>
}): Promise<void> => {
  await args.takeOver.lapped({ lap: ETakeoverLap.Settle, work: args.settle })
  await args.takeOver.lapped({ lap: ETakeoverLap.Commands, work: args.commands })
}
