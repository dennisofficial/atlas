import type { Command, CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'

import { renameHandler, type RenamePlane } from './rename/control'
import { rename } from './rename/spec'
import { rewindHandler } from './rewind/pod'
import { rewind } from './rewind/spec'
import { summariseHandler } from './summarise/pod'
import { summarise } from './summarise/spec'

export const nativeCommands: readonly Command[] = [rewind, rename, summarise]

export const nativeCommandHandlers: ReadonlyMap<string, CommandHandler<unknown>> = new Map([
  [rewind.inboxKind, rewindHandler],
  [summarise.inboxKind, summariseHandler],
])

export const nativeControlHandlers: ReadonlyMap<
  string,
  ControlCommandHandler<RenamePlane, unknown>
> = new Map([[rename.spec.name, renameHandler]])

export { REFUSAL_NOT_A_MESSAGE, REFUSAL_NOTHING_TO_REWIND, rewindTargetOf } from './rewind/spec'
export {
  REFUSAL_EMPTY_SUMMARY,
  REFUSAL_NO_MODEL,
  REFUSAL_SUMMARY_FAILED,
} from './summarise/pod'
