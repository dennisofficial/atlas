import { EServeFrame } from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'

import { messageOf } from './message-of'
import { answerRequest } from './requests'
import type { ReplyFrame, RequestFrame } from './request-reply'

export const routeFileRequest = (args: {
  frame: RequestFrame
  files: Pick<FileBrowser, 'list' | 'read' | 'search'>
  reply: (reply: ReplyFrame) => void
}): void => {
  const { frame, files, reply } = args
  void answerRequest({ frame, files })
    .then(reply)
    .catch((error: unknown) =>
      reply({
        kind: EServeFrame.Reply,
        replyTo: frame.id,
        ok: false,
        data: { message: messageOf(error, 'the request failed') },
      }),
    )
}
