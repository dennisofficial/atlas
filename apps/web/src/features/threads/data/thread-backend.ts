import type { PodStatus, WireEvent } from '@dltech/atlas-wire/web'

import { fetchSpawned } from './agents-api'
import type { EventsFetcher } from './events-reader'
import type { SnapshotFetcher } from './events-snapshot'
import { connectPod, type PodConnectResult } from './pod-connect'
import type { LiveSend } from './live-thread-view'
import type { SubscribeThreadStream } from './thread-signals'
import {
  fetchEvents,
  fetchSnapshot,
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
  fetchSnapshot?: SnapshotFetcher
  fetchSeed: (threadId: string) => Promise<WireEvent[]>
  fetchSpawned: (threadId: string) => Promise<SpawnedThreads>
  mint: (threadId: string) => Promise<PodConnectResult>
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
  fetchSnapshot,
  fetchSeed: (threadId) => fetchEvents({ threadId }),
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
