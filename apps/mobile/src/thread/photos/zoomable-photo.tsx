import { Image } from 'expo-image'
import { useRef, useState } from 'react'
import { GestureDetector, useExclusiveGestures, useTapGesture } from 'react-native-gesture-handler'
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
} from 'react-native'

import {
  DOUBLE_TAP_MAX_DELAY_MS,
  MAX_ZOOM_SCALE,
  type Size,
  shouldDismiss,
  zoomedInBy,
  zoomRectOf,
} from './photo-zoom'

export const ZoomablePhoto = ({
  uri,
  name,
  onDismiss,
  onTap,
  onZoomIn,
}: {
  uri: string
  name: string
  onDismiss: () => void
  onTap: () => void
  onZoomIn: () => void
}) => {
  const scrollRef = useRef<ScrollViewInstance>(null)
  const zoomScale = useRef(1)
  const [viewport, setViewport] = useState<Size | undefined>(undefined)

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setViewport({ width, height })
  }

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextScale = event.nativeEvent.zoomScale ?? 1
    const previousScale = zoomScale.current
    zoomScale.current = nextScale
    if (zoomedInBy({ previousScale, nextScale })) onZoomIn()
  }

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scale = event.nativeEvent.zoomScale ?? zoomScale.current
    if (shouldDismiss({ pullY: event.nativeEvent.contentOffset.y, zoomScale: scale })) onDismiss()
  }

  const handleDoubleTap = (point: { x: number; y: number }) => {
    if (Platform.OS !== 'ios' || viewport === undefined) return
    scrollRef.current?.scrollResponderZoomTo({
      ...zoomRectOf({ point, viewport, zoomScale: zoomScale.current }),
      animated: true,
    })
  }

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: DOUBLE_TAP_MAX_DELAY_MS,
    runOnJS: true,
    onActivate: (event) => handleDoubleTap({ x: event.x, y: event.y }),
  })
  const singleTap = useTapGesture({ runOnJS: true, onActivate: onTap })
  const taps = useExclusiveGestures(doubleTap, singleTap)

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
        <GestureDetector gesture={taps}>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={name}
            accessibilityHint="Tap to show or hide the controls. Pinch or double-tap to zoom. Swipe down to close."
            style={viewport}
          >
            <Image source={{ uri }} contentFit="contain" style={styles.fill} />
          </View>
        </GestureDetector>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
})
