import type { AtlasNotification } from '@dltech/atlas-core'
import { EFontWeight, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bannerFrameOf } from './banner-frame'

export const InAppBanner = (props: {
  notice: AtlasNotification
  onOpen: () => void
  onDismiss: () => void
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.layer, bannerFrameOf(insets)]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.notice.title}. ${props.notice.body}`}
        onPress={props.onOpen}
        style={[styles.banner, { backgroundColor: theme.card, borderColor: theme.border }]}
      >
        <View style={styles.copy}>
          <Text size={ETextRole.Sm} weight={EFontWeight.Semibold} numberOfLines={1}>
            {props.notice.title}
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={2}>
            {props.notice.body}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={props.onDismiss}
          hitSlop={8}
        >
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Dismiss
          </Text>
        </Pressable>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    zIndex: 20,
  },
  banner: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
})
