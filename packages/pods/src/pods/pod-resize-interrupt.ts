export const POD_RESIZE_STARTED_WAIT_MS = 20_000
export const POD_RESIZE_STARTED_POLL_MS = 1_000

export type PodResizeStartedPost = { sessionId: string; inboxId: number }

export type PodResizeInterruptDeps = {
  started(args: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }): Promise<{ inboxId: number }>
  consumed(args: { sessionId: string; inboxId: number }): Promise<boolean>
  sleep(args: { ms: number }): Promise<void>
}

const unconsumedOf = async (args: {
  deps: PodResizeInterruptDeps
  posts: readonly PodResizeStartedPost[]
}): Promise<PodResizeStartedPost[]> => {
  const waiting: PodResizeStartedPost[] = []
  for (const post of args.posts) {
    if (!(await args.deps.consumed(post))) waiting.push(post)
  }
  return waiting
}

export const announceResize = async (args: {
  deps: PodResizeInterruptDeps
  sessionIds: readonly string[]
  shape: { vcpus: number; memoryGb: number }
  generation: number
}): Promise<void> => {
  const posts: PodResizeStartedPost[] = []
  for (const sessionId of args.sessionIds) {
    const posted = await args.deps.started({
      sessionId,
      ...args.shape,
      generation: args.generation,
    })
    posts.push({ sessionId, inboxId: posted.inboxId })
  }
  let waiting = posts
  for (
    let waited = 0;
    waited < POD_RESIZE_STARTED_WAIT_MS && waiting.length > 0;
    waited += POD_RESIZE_STARTED_POLL_MS
  ) {
    await args.deps.sleep({ ms: POD_RESIZE_STARTED_POLL_MS })
    waiting = await unconsumedOf({ deps: args.deps, posts: waiting })
  }
}
