import type { ThreadStorePort } from '@dltech/atlas-harness'

type Unsubscribe = () => void

export function mirrorCloudRenames(args: {
  home: Pick<ThreadStorePort, 'rename'>
  remote: Pick<ThreadStorePort, 'onRename'>
}): Unsubscribe {
  return args.remote.onRename(({ threadId, title }) => {
    void args.home.rename({ threadId, title }).catch(() => undefined)
  })
}
