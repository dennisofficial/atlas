import { Image } from 'expo-image'
import { useRef, useState } from 'react'
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
} from 'react-native'

import { isDoubleTap, MAX_ZOOM_SCALE, type Size, shouldDismiss, zoomRectOf } from './photo-zoom'

export const ZoomablePhoto = ({
  uri,
  name,
  onDismiss,
}: {
  uri: string
  name: string
  onDismiss: () => void
}) => {
  const scrollRef = useRef<ScrollViewInstance>(null)
  const zoomScale = useRef(1)
  const lastTapAt = useRef<number | undefined>(undefined)
  const [viewport, setViewport] = useState<Size | undefined>(undefined)

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setViewport({ width, height })
  }

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    zoomScale.current = event.nativeEvent.zoomScale ?? 1
  }

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scale = event.nativeEvent.zoomScale ?? zoomScale.current
    if (shouldDismiss({ pullY: event.nativeEvent.contentOffset.y, zoomScale: scale })) onDismiss()
  }

  const handlePress = (event: GestureResponderEvent) => {
    const at = Date.now()
    if (!isDoubleTap({ previousAt: lastTapAt.current, at })) {
      lastTapAt.current = at
      return
    }
    lastTapAt.current = undefined
    if (Platform.OS !== 'ios' || viewport === undefined) return
    const point = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
    scrollRef.current?.scrollResponderZoomTo({
      ...zoomRectOf({ point, viewport, zoomScale: zoomScale.current }),
      animated: true,
    })
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.fill}
      contentContainerStyle={viewport}
      contentInsetAdjustmentBehavior="never"
      maximumZoomScale={MAX_ZOOM_SCALE}
      minimumZoomScale={1}
      bouncesZoom
      centerContent
      alwaysBounceVertical
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onLayout={handleLayout}
      onScroll={handleScroll}
      onScrollEndDrag={handleScrollEndDrag}
    >
      {viewport === undefined ? null : (
        <Pressable
          accessibilityRole="image"
          accessibilityLabel={name}
          accessibilityHint="Pinch or double-tap to zoom. Swipe down to close."
          onPress={handlePress}
          style={viewport}
        >
          <Image source={{ uri }} contentFit="contain" style={styles.fill} />
        </Pressable>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
})
