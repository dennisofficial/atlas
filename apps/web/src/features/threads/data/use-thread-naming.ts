import type { PodStatus } from '@dltech/atlas-wire/web'

import { UNTITLED } from './untitled'
import { namingStateOf, type NamingState } from './naming-state'
import { usePublishNaming } from './use-publish-naming'

export function useThreadNaming(args: {
  threadId: string
  loading: boolean
  storedTitle: string | null
  liveTitle: string | null
  titling: boolean
  pod: PodStatus | null
}): NamingState & { headerTitle: string | null } {
  const { threadId, loading, storedTitle, liveTitle, titling, pod } = args
  const state = namingStateOf({ storedTitle, liveTitle, titling, pod })
  const naming = !loading && state.naming
  usePublishNaming({ threadId, title: state.title, naming })
  const headerTitle = loading ? null : (state.title ?? (naming ? null : UNTITLED))
  return { title: state.title, naming, headerTitle }
}
