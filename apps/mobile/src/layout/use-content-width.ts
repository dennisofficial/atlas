import { useWindowDimensions } from 'react-native'

import { contentWidthOf } from './posture'
import { useWindowInsets } from './side-inset-frame'

export const useContentWidth = (): number => {
  const { width } = useWindowDimensions()
  return contentWidthOf({ windowWidth: width, insets: useWindowInsets() })
}
