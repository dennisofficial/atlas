import { useCallback, useState } from 'react'

import { closedOverlayOf, scopedOverlayOf, type TOverlayScope } from './scoped-overlay'

export type TScopedOverlayState = { open: boolean; setOpen: (open: boolean) => void }

export const useScopedOverlay = ({ layout, screen }: TOverlayScope): TScopedOverlayState => {
  const [overlay, setOverlay] = useState(() => closedOverlayOf({ layout, screen }))
  const current = scopedOverlayOf({ overlay, scope: { layout, screen } })
  if (current !== overlay) setOverlay(current)
  const setOpen = useCallback(
    (open: boolean) => setOverlay({ open, scope: { layout, screen } }),
    [layout, screen],
  )
  return { open: current.open, setOpen }
}
