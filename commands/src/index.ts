import type { Command, CommandHandler } from '@dltech/atlas-commands'

import { rewindHandler } from './rewind/pod'
import { rewind } from './rewind/spec'

export const nativeCommands: readonly Command[] = [rewind]

export const nativeCommandHandlers: ReadonlyMap<string, CommandHandler<unknown>> = new Map([
  [rewind.inboxKind, rewindHandler],
])

export { REFUSAL_NOT_A_MESSAGE, REFUSAL_NOTHING_TO_REWIND, rewindTargetOf } from './rewind/spec'
