import { EThreadStreamFrame } from '@dltech/atlas-wire/web'

import {
  timeoutSchedule,
  type Schedule,
  type SubscribeThreadStream,
  type ThreadStreamHandlers,
} from '@/features/threads/data/thread-signals'

import { fetchLocalPodStatus } from './desktop-wire'
import { hasDesktopHost } from './desktop-http'
import { listLocalThreads, type LocalThread } from './local-thread-wire'

const POLL_INTERVAL_MS = 1000

type MetadataListener = {
  threadId: string
  listener: (thread: LocalThread) => void
  signature?: string
}

type Stream = {
  threadId: string
  handlers: ThreadStreamHandlers
  started: boolean
  thread: LocalThread | undefined
  pod: string | undefined
}

export function createLocalThreadFeed(args: { schedule?: Schedule } = {}) {
  const schedule = args.schedule ?? timeoutSchedule
  const listeners = new Set<{ listener: () => void; signature?: string }>()
  const streams = new Set<Stream>()
  const metadataListeners = new Set<MetadataListener>()
  const readingPods = new Set<string>()
  let running = false
  let cancel: (() => void) | undefined
  const active = () => listeners.size > 0 || streams.size > 0 || metadataListeners.size > 0

  const refreshPods = (recipients: readonly Stream[]) => {
    const threadIds = new Set(
      recipients.filter((stream) => streams.has(stream)).map((stream) => stream.threadId),
    )
    for (const threadId of threadIds) {
      if (readingPods.has(threadId)) continue
      const recipientsForThread = recipients.filter((stream) => stream.threadId === threadId)
      readingPods.add(threadId)
      void fetchLocalPodStatus(threadId)
        .then((pod) => {
          const signature = JSON.stringify(pod)
          for (const stream of recipientsForThread) {
            if (!streams.has(stream) || stream.pod === signature) continue
            stream.pod = signature
            stream.handlers.onData({ type: EThreadStreamFrame.Pod, status: pod })
          }
        })
        .catch(() => undefined)
        .finally(() => {
          readingPods.delete(threadId)
        })
    }
  }

  const poll = async () => {
    if (running || !active()) return
    running = true
    const recipients = [...streams]
    const listRecipients = [...listeners]
    const metadataRecipients = [...metadataListeners]
    try {
      const threads = await listLocalThreads()
      const signature = JSON.stringify(threads)
      for (const recipient of listRecipients) {
        if (!listeners.has(recipient) || recipient.signature === signature) continue
        recipient.signature = signature
        recipient.listener()
      }
      for (const recipient of metadataRecipients) {
        if (!metadataListeners.has(recipient)) continue
        const thread = threads.find((item) => item.threadId === recipient.threadId)
        if (thread === undefined) continue
        const signature = JSON.stringify(thread)
        if (recipient.signature === signature) continue
        recipient.signature = signature
        recipient.listener(thread)
      }
      for (const stream of recipients) {
        if (!streams.has(stream)) continue
        const thread = threads.find((item) => item.threadId === stream.threadId)
        if (!stream.started) {
          stream.started = true
          stream.handlers.onStarted()
        }
        if (!streams.has(stream)) continue
        if (thread !== undefined && thread.head !== stream.thread?.head) {
          stream.handlers.onData({ type: EThreadStreamFrame.Head, head: thread.head })
        }
        if (!streams.has(stream)) continue
        if (thread !== undefined && thread.title !== stream.thread?.title) {
          stream.handlers.onData({ type: EThreadStreamFrame.Title })
        }
        stream.thread = thread
      }
      refreshPods(recipients)
    } catch (failure) {
      for (const stream of recipients) if (streams.has(stream)) stream.handlers.onError(failure)
      for (const recipient of listRecipients) {
        if (!listeners.has(recipient)) continue
        delete recipient.signature
        recipient.listener()
      }
    } finally {
      running = false
      if (active())
        cancel = schedule({
          delayMs: POLL_INTERVAL_MS,
          run: () => {
            cancel = undefined
            void poll()
          },
        })
    }
  }

  const start = () => {
    if (running || cancel !== undefined) return
    void poll()
  }
  const stopIfIdle = () => {
    if (active()) return
    cancel?.()
    cancel = undefined
  }

  const subscribeChanges = (listener: () => void): (() => void) => {
    if (!hasDesktopHost()) return () => undefined
    const recipient = { listener }
    listeners.add(recipient)
    start()
    return () => {
      listeners.delete(recipient)
      stopIfIdle()
    }
  }
  const subscribeStream: SubscribeThreadStream = ({ threadId, handlers }) => {
    if (!hasDesktopHost()) return { unsubscribe: () => undefined }
    const stream: Stream = { threadId, handlers, started: false, thread: undefined, pod: undefined }
    streams.add(stream)
    start()
    return {
      unsubscribe: () => {
        streams.delete(stream)
        stopIfIdle()
      },
    }
  }
  const subscribeMetadata = (args: {
    threadId: string
    listener: (thread: LocalThread) => void
  }): (() => void) => {
    if (!hasDesktopHost()) return () => undefined
    const recipient: MetadataListener = { ...args }
    metadataListeners.add(recipient)
    start()
    return () => {
      metadataListeners.delete(recipient)
      stopIfIdle()
    }
  }
  return { subscribeChanges, subscribeStream, subscribeMetadata }
}

const localThreadFeed = createLocalThreadFeed()
export const subscribeLocalThreadChanges = localThreadFeed.subscribeChanges
export const subscribeLocalThreadStream = localThreadFeed.subscribeStream
export const subscribeLocalThreadMetadata = localThreadFeed.subscribeMetadata
