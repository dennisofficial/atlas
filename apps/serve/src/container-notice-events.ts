import type { EventDraft, NoticePort, NoticePost, ThreadId } from '@dltech/atlas-core'

import { CONTAINER_SETUP_FAILURE_KEY } from './container-setup'
import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'

export const collectNotices = (inner: NoticePort): { port: NoticePort; posts: NoticePost[] } => {
  const posts: NoticePost[] = []
  return {
    posts,
    port: {
      notify: (post) => {
        posts.push(post)
        inner.notify(post)
      },
    },
  }
}

export async function recordNoticeEvents(args: {
  posts: readonly NoticePost[]
  threadId: ThreadId
  app: {
    log: Pick<ServeApp['log'], 'append'>
    ids: Pick<ServeApp['ids'], 'nextRunId'>
    channel: { publisherFor: (args: { threadId: ThreadId }) => { eventsAppended: () => void } }
  }
  log: ServeLog
}): Promise<void> {
  if (args.posts.length === 0) return
  const drafts: EventDraft[] = args.posts.map((post) => ({
    type: 'sandbox-setup-reported',
    text: post.text,
    failed: post.key === CONTAINER_SETUP_FAILURE_KEY,
  }))
  try {
    await args.app.log.append({
      threadId: args.threadId,
      runId: args.app.ids.nextRunId(),
      drafts,
    })
    args.app.channel.publisherFor({ threadId: args.threadId }).eventsAppended()
  } catch (failure) {
    args.log({
      event: EServeEvent.TurnFailed,
      reason: `recording the container notices as an event failed: ${
        failure instanceof Error ? failure.message : String(failure)
      }`,
    })
  }
}
