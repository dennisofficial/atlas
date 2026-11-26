import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { postureOf, type TPosture } from './posture'

const PostureContext = createContext<TPosture | null>(null)

const useWindowPosture = (): TPosture => {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  return useMemo(() => postureOf({ width, height, insets }), [width, height, insets])
}

export const PostureProvider = ({ children }: { children: ReactNode }) => (
  <PostureContext.Provider value={useWindowPosture()}>{children}</PostureContext.Provider>
)

export const usePosture = (): TPosture => {
  const provided = useContext(PostureContext)
  const measured = useWindowPosture()
  return provided ?? measured
}
