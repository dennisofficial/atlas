import { ETextRole, ETextTone, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Archive, ArchiveRestore } from 'lucide-react-native'
import { type ReactNode, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated'

import { rowSwipeHitSlopOf } from './drawer-pan'
import { LIST_EDGE_INSET } from './session-row-layout'

const ACTION_WIDTH = 88
const ROW_SWIPE_HIT_SLOP = rowSwipeHitSlopOf({ listEdgeInset: LIST_EDGE_INSET })

let openSwipe: SwipeableMethods | null = null

const claimOpen = (methods: SwipeableMethods): void => {
  if (openSwipe !== null && openSwipe !== methods) openSwipe.close()
  openSwipe = methods
}

const releaseOpen = (methods: SwipeableMethods): void => {
  if (openSwipe === methods) openSwipe = null
}

const ArchiveAction = ({
  archived,
  progress,
  onPress,
}: {
  archived: boolean
  progress: SharedValue<number>
  onPress: () => void
}) => {
  const theme = useTheme()
  const label = archived ? 'Unarchive' : 'Archive'
  const revealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5, 1], [0, 0.6, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.85, 1], Extrapolation.CLAMP) }],
  }))
  return (
    <Animated.View
      style={[styles.action, revealStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={[
          styles.actionButton,
          { backgroundColor: withAlpha({ color: theme.destructive, alpha: 0.14 }) },
        ]}
      >
        <Icon icon={archived ? ArchiveRestore : Archive} size={18} color={theme.destructive} />
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

export const SwipeableSessionRow = ({
  archived,
  onArchive,
  children,
}: {
  archived: boolean
  onArchive: () => void
  children: ReactNode
}) => {
  const theme = useTheme()
  const swipeRef = useRef<SwipeableMethods | null>(null)

  const handleOpen = () => {
    if (swipeRef.current !== null) claimOpen(swipeRef.current)
  }

  const handleClose = () => {
    if (swipeRef.current !== null) releaseOpen(swipeRef.current)
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      hitSlop={ROW_SWIPE_HIT_SLOP}
      onSwipeableOpen={handleOpen}
      onSwipeableClose={handleClose}
      childrenContainerStyle={[styles.row, { backgroundColor: theme.sidebar }]}
      renderRightActions={(progress) => (
        <ArchiveAction archived={archived} progress={progress} onPress={onArchive} />
      )}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    paddingLeft: space(1),
    width: ACTION_WIDTH,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flex: 1,
    gap: space(0.5),
    justifyContent: 'center',
  },
  row: {
    borderRadius: radius(0.8),
  },
})
