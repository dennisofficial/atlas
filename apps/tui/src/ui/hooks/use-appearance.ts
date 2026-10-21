import { useSyncExternalStore } from 'react'

import { composerEdgeVersion, subscribeComposerEdge } from '../composer-edge-store'
import { densityVersion, subscribeDensity } from '../density-store'
import { logoVersion, subscribeLogo } from '../logo-store'
import { paletteVersion, subscribePalette } from '../palette-store'

export function useAppearance(): void {
  useSyncExternalStore(subscribePalette, paletteVersion)
  useSyncExternalStore(subscribeDensity, densityVersion)
  useSyncExternalStore(subscribeComposerEdge, composerEdgeVersion)
  useSyncExternalStore(subscribeLogo, logoVersion)
}
