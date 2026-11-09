import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { foldLiveBuffer, type FoldedStep } from './fold-live-buffer'
import { shellFramesOf, type ShellFrame } from './shell-frames'

export type JoinRead =
  | { ok: true; folded: FoldedStep | undefined; shells: readonly ShellFrame[] }
  | { ok: false }

export const readJoin = async (args: {
  readBuffer(): Promise<string | null>
  readShellBacklog(): Promise<string[]>
  log: LogPort | undefined
}): Promise<JoinRead> => {
  try {
    const [buffer, shells] = await Promise.all([args.readBuffer(), args.readShellBacklog()])
    return { ok: true, folded: foldLiveBuffer(buffer), shells: shellFramesOf(shells) }
  } catch (error) {
    args.log?.error({
      source: 'stream',
      message: 'reading the live buffer failed',
      ...logFieldsOf({ error }),
    })
    return { ok: false }
  }
}
