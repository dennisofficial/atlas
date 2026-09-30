import type { ThreadStorePort } from '@dltech/atlas-harness'

type Unsubscribe = () => void

/**
 * The local thread-meta row is the pointer every later boot reads: `/restart` resumes by the slug
 * of the on-screen title, and the resume lookup scans this store by name. A rename announced from
 * the sandbox — its auto-titler, or a `/rename` echoed back — only ever reached in-memory React
 * state, so the name outlived neither the session nor the lift. Mirror it into the home store the
 * moment the channel announces it; the sandbox remains the transcript's owner, and this write is
 * the same one a local rename would have made.
 */
export function mirrorCloudRenames(args: {
  home: Pick<ThreadStorePort, 'rename'>
  remote: Pick<ThreadStorePort, 'onRename'>
}): Unsubscribe {
  return args.remote.onRename(({ threadId, title }) => {
    void args.home.rename({ threadId, title }).catch(() => undefined)
  })
}
