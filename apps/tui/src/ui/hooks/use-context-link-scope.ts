import { useEffect, useRef, type RefObject } from 'react'
import type { BoxRenderable } from '@opentui/core'

import { EContextLink, routeContextLink } from '../../composition/context-link-route'
import { ELinkVerdict, registerLinkScope } from '../../composition/link-scope'

export function useContextLinkScope(args: {
  box: RefObject<BoxRenderable | null>
  path: string
  onNavigate: ((path: string) => void) | undefined
}): void {
  const { box } = args
  const latest = useRef({ path: args.path, onNavigate: args.onNavigate })
  latest.current = { path: args.path, onNavigate: args.onNavigate }

  useEffect(
    () =>
      registerLinkScope({
        contains: ({ x, y }) => {
          const pane = box.current
          if (pane === null || pane.isDestroyed || !pane.visible) return false
          return x >= pane.x && x < pane.x + pane.width && y >= pane.y && y < pane.y + pane.height
        },
        handle: (href) => {
          const { path, onNavigate } = latest.current
          const route = routeContextLink({ href, from: path })
          if (route.kind === EContextLink.External) return { kind: ELinkVerdict.Pass }
          if (route.kind === EContextLink.File) return { kind: ELinkVerdict.Open, url: route.url }
          if (route.kind === EContextLink.Context && route.path !== path) onNavigate?.(route.path)
          return { kind: ELinkVerdict.Handled }
        },
      }),
    [box],
  )
}
