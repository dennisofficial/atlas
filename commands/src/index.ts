import type { Command, CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'

import { renameHandler, type RenamePlane } from './rename/control'
import { rename } from './rename/spec'
import { rewindHandler } from './rewind/pod'
import { rewind } from './rewind/spec'

export const nativeCommands: readonly Command[] = [rewind, rename]

export const nativeCommandHandlers: ReadonlyMap<string, CommandHandler<unknown>> = new Map([
  [rewind.inboxKind, rewindHandler],
])

export const nativeControlHandlers: ReadonlyMap<
  string,
  ControlCommandHandler<RenamePlane, unknown>
> = new Map([[rename.spec.name, renameHandler]])

export { REFUSAL_NOT_A_MESSAGE, REFUSAL_NOTHING_TO_REWIND, rewindTargetOf } from './rewind/spec'
