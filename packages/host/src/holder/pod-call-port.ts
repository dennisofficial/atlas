import type {
  PodCallReply,
  PodCallReplyOutcome,
  PodCallRequest,
  PodReady,
  PodStreamFrame,
} from '@dltech/atlas-protocol'

export type PodCallBus = {
  readonly requesterId: string
  request(args: {
    request: PodCallRequest
    timeoutMs: number
    signal?: AbortSignal | undefined
  }): Promise<PodCallReplyOutcome>
  onRequest(listener: (request: PodCallRequest) => void): () => void
  reply(args: { replyTo: string; reply: PodCallReply }): Promise<void>
  publishFrame(args: { streamId: string; frame: PodStreamFrame }): Promise<void>
  subscribeFrames(args: {
    streamId: string
    listener: (frame: PodStreamFrame) => void
  }): Promise<() => Promise<void>>
  ready(ready: PodReady): Promise<void>
  onReady(listener: (ready: PodReady) => void): () => void
  close(): Promise<void>
}
