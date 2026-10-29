import { unreadableRequestIdOf } from '@dltech/atlas-wire'

import { refusedRequest, type ReplyFrame } from './request-reply'

export const UNREADABLE_REQUEST_MESSAGE = 'this sandbox serve does not understand that request'

/** A request from a newer client that this serve cannot read is refused alone, keeping the socket. */
export const unreadableRequestReplyOf = (raw: string): ReplyFrame | null => {
  const replyTo = unreadableRequestIdOf(raw)
  if (replyTo === null) return null
  return refusedRequest({ replyTo, message: UNREADABLE_REQUEST_MESSAGE })
}
