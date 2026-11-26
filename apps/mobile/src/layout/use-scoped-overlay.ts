import { useCallback, useState } from 'react'

import { defaultOverlayOf, scopedOverlayOf, type TOverlayScope } from './scoped-overlay'

export type TScopedOverlayState = { open: boolean; setOpen: (open: boolean) => void }

export const useScopedOverlay = ({
  scope,
  openByDefault,
}: {
  scope: TOverlayScope
  openByDefault: boolean
}): TScopedOverlayState => {
  const { layout, screen } = scope
  const [overlay, setOverlay] = useState(() => defaultOverlayOf({ scope, openByDefault }))
  const current = scopedOverlayOf({ overlay, scope, openByDefault })
  if (current !== overlay) setOverlay(current)
  const setOpen = useCallback(
    (open: boolean) => setOverlay({ open, scope: { layout, screen } }),
    [layout, screen],
  )
  return { open: current.open, setOpen }
}
