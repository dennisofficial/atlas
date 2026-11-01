import type { SaidUpload } from '@dltech/atlas-core'
import {
  createThreadReplySchema,
  type SaidImageWire,
  type WireSessionNode,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import type { CreateThreadBody } from './create-thread'
import type { SubscribeThreadsLive } from '@/features/shell/live-stream'
import type { SubscribeThreadStream } from './thread-signals'
import type { ApiPrStatesSubscribe } from './api-pr-states-source'
import { trackedThreadStreamHandlers } from './thread-stream-adapter'
import { prObservationInputOf } from './pr-observation-targets'

export const fetchProjects = () => cloudCall(api.projects.list.query())

export type SessionNode = WireSessionNode

export const createThread = async (body: CreateThreadBody) =>
  createThreadReplySchema.parse(await cloudCall(api.threads.create.mutate(body)))

export const fetchThread = (threadId: string) => cloudCall(api.threads.get.query({ threadId }))

export const provisionSandbox = (args: { threadId: string }) =>
  cloudCall(api.threadSandbox.provision.mutate({ threadId: args.threadId }))

export const fetchPod = (threadId: string) => cloudCall(api.threadPod.status.query({ threadId }))

export const takeBackMessage = (args: { threadId: string; sendId: string }) =>
  cloudCall(api.threadMessages.takeBack.mutate(args))

export const postMessage = (args: {
  threadId: string
  sendId: string
  text: string
  images?: SaidImageWire[]
  uploads?: SaidUpload[]
}) => cloudCall(api.threadMessages.send.mutate(args))

export const fetchEvents = (args: { threadId: string; fromSeq?: number | undefined }) =>
  cloudCall(
    api.threadEvents.read.query({
      threadId: args.threadId,
      own: true,
      ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
    }),
  )

export const fetchSnapshot = (args: { threadId: string; fromSeq?: number | undefined }) =>
  cloudCall(api.threadEvents.snapshot.query(args))

export const patchThreadModel = (args: {
  threadId: string
  model: { ref: string; effort: string }
}) => cloudCall(api.threads.chooseModel.mutate({ threadId: args.threadId, ...args.model }))

export const rewindThread = (args: { threadId: string; toSeq: number; cutAgents: string[] }) =>
  cloudCall(api.threads.rewind.mutate(args))

export const setThreadArchived = (args: { threadId: string; archived: boolean }) =>
  cloudCall(api.threads.archive.mutate(args))

export const subscribeThreadStream: SubscribeThreadStream = ({
  threadId,
  handlers,
  lastEventId,
  onCursor,
}) =>
  api.threadEvents.live.subscribe(
    { threadId, lastEventId },
    trackedThreadStreamHandlers({ handlers, onCursor }),
  )

export const subscribeThreadsLive: SubscribeThreadsLive = (handlers) =>
  api.threads.live.subscribe(undefined, handlers)

export const subscribePrStatesFromApi: ApiPrStatesSubscribe = ({ observe, ...handlers }) =>
  api.githubPrs.states.subscribe(prObservationInputOf(observe), handlers)

export const resizePod = (args: { threadId: string; vcpus: number }) =>
  cloudCall(api.threadPod.resize.mutate(args))

export const markThreadRead = (args: { threadId: string; seq: number }) =>
  cloudCall(api.threads.markRead.mutate(args))
