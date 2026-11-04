import { useHinge } from 'expo-hinge'
import { useMemo } from 'react'
import { useWindowDimensions } from 'react-native'

import { type PaneLayout, paneLayoutOf } from './pane-layout'

export const usePaneLayout = (): PaneLayout => {
  const { width } = useWindowDimensions()
  const hingeStatus = useHinge()?.status ?? null
  return useMemo(() => paneLayoutOf({ width, hingeStatus }), [width, hingeStatus])
}
