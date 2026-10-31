import type { PodStatus, WireEvent } from '@dltech/atlas-wire/web'

import { fetchSpawned } from './agents-api'
import type { EventsFetcher } from './events-reader'
import { fetchStoredThread, fetchTranscriptEvents } from './transcript-history'
import { connectPod, type PodConnectResult } from './pod-connect'
import type { LiveSend } from './live-thread-view'
import type { SubscribeThreadStream } from './thread-signals'
import {
  fetchEvents,
  fetchPod,
  fetchThread,
  markThreadRead,
  patchThreadModel,
  postMessage,
  provisionSandbox,
  resizePod,
  rewindThread,
  subscribeThreadStream,
  takeBackMessage,
} from './threads-api'

type CloudThread = Awaited<ReturnType<typeof fetchThread>>
type SpawnedThreads = Awaited<ReturnType<typeof fetchSpawned>>

export type ThreadBackend = {
  local: boolean
  fetchThread: (threadId: string) => Promise<CloudThread>
  fetchPod: (threadId: string) => Promise<PodStatus>
  fetchEvents: EventsFetcher
  fetchSeed: (threadId: string) => Promise<WireEvent[]>
  readStoredThread: (threadId: string) => Promise<CloudThread>
  fetchSpawned: (threadId: string) => Promise<SpawnedThreads>
  mint: (threadId: string) => Promise<PodConnectResult>
  wake?: (threadId: string) => Promise<PodConnectResult>
  rename?: (args: { threadId: string; title: string }) => Promise<void>
  postMessage: typeof postMessage
  takeBack: typeof takeBackMessage
  patchModel: typeof patchThreadModel
  rewind: typeof rewindThread
  provision: (args: { threadId: string }) => Promise<unknown>
  resize: typeof resizePod
  markRead: (args: { threadId: string; seq: number }) => Promise<unknown>
  subscribeStream: SubscribeThreadStream
  afterConnect: (args: { threadId: string; send: LiveSend }) => void
}

export const cloudThreadBackend: ThreadBackend = {
  local: false,
  fetchThread,
  fetchPod,
  fetchEvents,
  fetchSeed: fetchTranscriptEvents,
  readStoredThread: fetchStoredThread,
  fetchSpawned,
  mint: connectPod,
  postMessage,
  takeBack: takeBackMessage,
  patchModel: patchThreadModel,
  rewind: rewindThread,
  provision: provisionSandbox,
  resize: resizePod,
  markRead: markThreadRead,
  subscribeStream: subscribeThreadStream,
  afterConnect: () => undefined,
}
