import { ETextRole, ETextTone, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Archive, ArchiveRestore } from 'lucide-react-native'
import { type ReactNode, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import { type SharedValue, useAnimatedReaction, useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

const ACTION_WIDTH = 88
const FULL_SWIPE_DISTANCE = 160

let openSwipe: SwipeableMethods | null = null

const claimOpen = (methods: SwipeableMethods): void => {
  if (openSwipe !== null && openSwipe !== methods) openSwipe.close()
  openSwipe = methods
}

const releaseOpen = (methods: SwipeableMethods): void => {
  if (openSwipe === methods) openSwipe = null
}

const FullSwipeCommit = ({
  translation,
  onCommit,
}: {
  translation: SharedValue<number>
  onCommit: () => void
}) => {
  const fired = useSharedValue(false)
  useAnimatedReaction(
    () => translation.value,
    (current) => {
      if (current > -FULL_SWIPE_DISTANCE) {
        fired.value = false
        return
      }
      if (fired.value) return
      fired.value = true
      scheduleOnRN(onCommit)
    },
  )
  return null
}

const ArchiveAction = ({
  archived,
  translation,
  onCommit,
}: {
  archived: boolean
  translation: SharedValue<number>
  onCommit: () => void
}) => {
  const theme = useTheme()
  const label = archived ? 'Unarchive' : 'Archive'
  return (
    <View style={styles.action}>
      <FullSwipeCommit translation={translation} onCommit={onCommit} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onCommit}
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
    </View>
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
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight
      overshootFriction={8}
      onSwipeableOpen={handleOpen}
      onSwipeableClose={handleClose}
      childrenContainerStyle={[styles.row, { backgroundColor: theme.sidebar }]}
      renderRightActions={(_progress, translation) => (
        <ArchiveAction archived={archived} translation={translation} onCommit={onArchive} />
      )}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

const styles = StyleSheet.create({
  action: {
    justifyContent: 'center',
    paddingHorizontal: space(1),
    width: ACTION_WIDTH,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    gap: space(0.5),
    justifyContent: 'center',
    paddingVertical: space(1),
  },
  row: {
    borderRadius: radius(0.8),
  },
})
