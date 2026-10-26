import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { fetchThread } from './threads-api'
import { UNTITLED } from './untitled'

const NO_PARENT = ''

export function useParentTitle(parentId: string | undefined): string | null {
  const parent = useCloudQuery({
    key: parentId ?? NO_PARENT,
    load: async () => (parentId === undefined ? undefined : await fetchThread(parentId)),
  })
  if (parentId === undefined || parent.state === EQueryState.Loading) return null
  return parent.data?.title ?? UNTITLED
}
