'use client'

import { usePathname } from 'next/navigation'

import { localThreadBackend } from '@/features/desktop/local-thread-backend'
import { useDesktop } from '@/features/desktop/use-desktop'
import { EThreadHome, useThreadHome } from '@/features/desktop/use-local-pod'
import { routeIdAfter } from '@/lib/route-id'

import { ThreadBackendProvider } from './data/use-thread-backend'
import { ThreadView } from './thread-view'
import { ThreadViewSkeleton } from './thread-view-skeleton'

export function ThreadRoute() {
  const threadId = routeIdAfter({
    pathname: usePathname(),
    segment: 'threads',
  })
  const home = useThreadHome({ threadId, desktop: useDesktop() })
  if (home === EThreadHome.Loading) return <ThreadViewSkeleton />
  if (home === EThreadHome.ThisMac) {
    return (
      <ThreadBackendProvider backend={localThreadBackend}>
        <ThreadView key={threadId} threadId={threadId} />
      </ThreadBackendProvider>
    )
  }
  return <ThreadView key={threadId} threadId={threadId} />
}
