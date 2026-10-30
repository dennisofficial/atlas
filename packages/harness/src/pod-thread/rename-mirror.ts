import type { ThreadStorePort } from '../store/thread-store'

export function mirrorPodRenames(args: {
  home: Pick<ThreadStorePort, 'rename'>
  remote: Pick<ThreadStorePort, 'onRename'>
}): () => void {
  return args.remote.onRename(({ threadId, title }) => {
    void args.home.rename({ threadId, title }).catch(() => undefined)
  })
}
