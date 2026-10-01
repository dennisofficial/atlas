import { EClientFrame, EServeFrame, type ClientFrame, type ServeFrame } from '@dltech/atlas-harness'

export type RequestFrame = Extract<ClientFrame, { kind: EClientFrame.Request }>
export type ReplyFrame = Extract<ServeFrame, { kind: EServeFrame.Reply }>

export const refusedRequest = (args: { replyTo: string; message: string }): ReplyFrame => ({
  kind: EServeFrame.Reply,
  replyTo: args.replyTo,
  ok: false,
  data: { message: args.message },
})

export const answeredRequest = (args: { replyTo: string; data: unknown }): ReplyFrame => ({
  kind: EServeFrame.Reply,
  replyTo: args.replyTo,
  ok: true,
  data: args.data,
})
