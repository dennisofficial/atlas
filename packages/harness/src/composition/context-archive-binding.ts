import type { NoticePort } from '@dltech/atlas-core'

import { captureContextArchive } from '../cloud/context-archive-policy'

/** A lift's context capture with the surface's notice port already bound in. */
export const boundCaptureContext = (args: {
  notice: NoticePort
}): (callArgs?: { cwd?: string | undefined }) => Promise<Buffer | undefined> => {
  const notice = args.notice
  return (callArgs) => captureContextArchive({ cwd: callArgs?.cwd, notice })
}
