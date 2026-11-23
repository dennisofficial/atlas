import type { Command, CommandHandler, ControlCommandHandler } from '@dltech/atlas-commands'

import { cancelResize, cancelResizeArgs } from './cancel-resize/spec'
import { help } from './help/spec'
import { model } from './model/spec'
import { renameHandler, type RenamePlane } from './rename/control'
import { resize, RESIZE_MAX_DISK_GB, resizeArgs } from './resize/spec'
import { rotate } from './rotate/spec'
import { rotateHandler } from './rotate/pod'
import { rename } from './rename/spec'
import { rewindHandler } from './rewind/pod'
import { rewind } from './rewind/spec'
import { summariseHandler } from './summarise/pod'
import { summarise } from './summarise/spec'

export const nativeCommands: readonly Command[] = [
  rewind,
  rename,
  summarise,
  rotate,
  resize,
  cancelResize,
  model,
  help,
]

export const nativeCommandHandlers: ReadonlyMap<string, CommandHandler<unknown>> = new Map([
  [rewind.inboxKind, rewindHandler],
  [summarise.inboxKind, summariseHandler],
  [rotate.inboxKind, rotateHandler],
])

export const nativeControlHandlers: ReadonlyMap<
  string,
  ControlCommandHandler<RenamePlane, unknown>
> = new Map([[rename.spec.name, renameHandler]])

export { cancelResize, cancelResizeArgs, help, model, RESIZE_MAX_DISK_GB, resize, resizeArgs }
export type { ResizeArgs } from './resize/spec'
export { REFUSAL_RENAME_NEEDS_NAME } from './rename/spec'
export { REFUSAL_RESIZE_USAGE } from './resize/spec'
export {
  REFUSAL_NOT_A_MESSAGE,
  REFUSAL_NOTHING_TO_REWIND,
  REFUSAL_REWIND_NEEDS_LINE,
  rewindTargetOf,
} from './rewind/spec'
export { REFUSAL_ROTATE_CHILDREN, rotate, rotateArgs } from './rotate/spec'
export { REFUSAL_SUMMARISE_ARGS, summariseArgs } from './summarise/spec'
export {
  REFUSAL_EMPTY_SUMMARY,
  REFUSAL_NO_MODEL,
  REFUSAL_SUMMARY_FAILED,
} from './summarise/pod'
export {
  REFUSAL_ROTATE_EMPTY,
  REFUSAL_ROTATE_FAILED,
  REFUSAL_ROTATE_NO_MODEL,
  REFUSAL_ROTATE_NOTHING,
  REFUSAL_ROTATE_UNCHANGED,
  ROTATE_TIMEOUT_MS,
  rotateNow,
} from './rotate/pod'
