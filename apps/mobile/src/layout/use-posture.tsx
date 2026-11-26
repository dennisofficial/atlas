import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { postureOf, type TInsets, type TPosture } from './posture'

type TWindowLayout = { posture: TPosture; insets: TInsets }

const PostureContext = createContext<TWindowLayout | null>(null)

const useWindowLayout = (): TWindowLayout => {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  return useMemo(
    () => ({ posture: postureOf({ width, height, insets }), insets }),
    [width, height, insets],
  )
}

export const PostureProvider = ({ children }: { children: ReactNode }) => (
  <PostureContext.Provider value={useWindowLayout()}>{children}</PostureContext.Provider>
)

const useProvidedLayout = (): TWindowLayout => {
  const provided = useContext(PostureContext)
  const measured = useWindowLayout()
  return provided ?? measured
}

export const usePosture = (): TPosture => useProvidedLayout().posture

export const useWindowInsets = (): TInsets => useProvidedLayout().insets
