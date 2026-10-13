import {
  EClientRequest,
  readSessionFilesParamsSchema,
} from '@dltech/atlas-harness'

import { answeredRequest, refusedRequest, type ReplyFrame, type RequestFrame } from './request-reply'
import type { SessionMirrorReader } from './session-mirror'

export const isSessionMirrorOp = (op: EClientRequest): boolean =>
  op === EClientRequest.ReadSessionManifest || op === EClientRequest.ReadSessionFiles

export type SessionMirrorRouting = {
  reader: SessionMirrorReader
  revision: () => number
}

export async function answerSessionMirrorRead(args: {
  frame: RequestFrame
  mirror: SessionMirrorRouting
}): Promise<ReplyFrame> {
  const { frame, mirror } = args
  const replyTo = frame.id

  if (frame.op === EClientRequest.ReadSessionManifest) {
    const { files } = await mirror.reader.manifest()
    return answeredRequest({
      replyTo,
      data: { revision: mirror.revision(), files },
    })
  }

  const parsed = readSessionFilesParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({ replyTo, message: 'read-session-files wants { paths }' })
  }
  const { files, missing } = await mirror.reader.readFiles({ paths: parsed.data.paths })
  return answeredRequest({ replyTo, data: { revision: mirror.revision(), files, missing } })
}

export function routeSessionMirrorRead(args: {
  frame: RequestFrame
  mirror: SessionMirrorRouting | undefined
  reply: (frame: ReplyFrame) => void
}): boolean {
  const { frame, mirror, reply } = args
  if (!isSessionMirrorOp(frame.op)) return false
  if (mirror === undefined) {
    reply(refusedRequest({ replyTo: frame.id, message: 'this serve has no session directory to mirror' }))
    return true
  }
  void answerSessionMirrorRead({ frame, mirror })
    .then(reply)
    .catch((error: unknown) =>
      reply(
        refusedRequest({
          replyTo: frame.id,
          message: error instanceof Error ? error.message : 'the session-mirror read failed',
        }),
      ),
    )
  return true
}
