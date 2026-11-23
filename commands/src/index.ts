import type { Command, CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'

import { help } from './help/spec'
import { model } from './model/spec'
import { renameHandler, type RenamePlane } from './rename/control'
import { resize, RESIZE_MAX_DISK_GB, resizeArgs } from './resize/spec'
import { rename } from './rename/spec'
import { rewindHandler } from './rewind/pod'
import { rewind } from './rewind/spec'
import { summariseHandler } from './summarise/pod'
import { summarise } from './summarise/spec'

export const nativeCommands: readonly Command[] = [rewind, rename, summarise, resize, model, help]

export const nativeCommandHandlers: ReadonlyMap<string, CommandHandler<unknown>> = new Map([
  [rewind.inboxKind, rewindHandler],
  [summarise.inboxKind, summariseHandler],
])

export const nativeControlHandlers: ReadonlyMap<
  string,
  ControlCommandHandler<RenamePlane, unknown>
> = new Map([[rename.spec.name, renameHandler]])

export { help, model, RESIZE_MAX_DISK_GB, resize, resizeArgs }
export type { ResizeArgs } from './resize/spec'
export { REFUSAL_RENAME_NEEDS_NAME } from './rename/spec'
export { REFUSAL_RESIZE_USAGE } from './resize/spec'
export {
  REFUSAL_NOT_A_MESSAGE,
  REFUSAL_NOTHING_TO_REWIND,
  REFUSAL_REWIND_NEEDS_LINE,
  rewindTargetOf,
} from './rewind/spec'
export { REFUSAL_SUMMARISE_ARGS, summariseArgs } from './summarise/spec'
export {
  REFUSAL_EMPTY_SUMMARY,
  REFUSAL_NO_MODEL,
  REFUSAL_SUMMARY_FAILED,
} from './summarise/pod'
