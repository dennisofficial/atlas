import type { RouterTransitionType } from 'next'

import {
  markRouteNavigationStart,
  startRouteNavigationTracking,
} from '@/lib/analytics/route-navigation-runtime'

startRouteNavigationTracking()

export function onRouterTransitionStart(url: string, navigationType: RouterTransitionType): void {
  markRouteNavigationStart({ url, navigationType })
}
