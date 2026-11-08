import { radius, space } from '@dltech/atlas-ui/tokens'
import { EFontFamily, ETextRole, ETextTone, Rule, Text, useTheme } from '@dltech/atlas-ui-native'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { ENoticeTone, type NoticeRow } from '../rows'

const toneOf = (tone: ENoticeTone): ETextTone => {
  if (tone === ENoticeTone.Attention) return ETextTone.Warning
  if (tone === ENoticeTone.Failed) return ETextTone.Destructive
  return ETextTone.Muted
}

export const NoticeRowView = ({ row }: { row: NoticeRow }) => {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)
  const tone = toneOf(row.tone)
  const handlePress = () => setExpanded((open) => !open)

  return (
    <View style={styles.root}>
      <View style={styles.title}>
        <Rule />
        <Text size={ETextRole.Xs} tone={tone} style={styles.titleText}>
          {row.title}
        </Text>
        <Rule />
      </View>
      {row.body.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Details, ${row.title}`}
          accessibilityState={{ expanded }}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
          onPress={handlePress}
          style={styles.toggle}
        >
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            {expanded ? 'Hide details' : 'Details'}
          </Text>
        </Pressable>
      ) : null}
      {expanded && row.body.length > 0 ? (
        <View style={[styles.box, { backgroundColor: theme.muted }]}>
          <Text size={ETextRole.Xs} family={EFontFamily.Mono} selectable>
            {row.body}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'stretch',
    borderRadius: radius(0.8),
    padding: space(3),
  },
  root: {
    alignItems: 'center',
    gap: space(2),
  },
  title: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: space(3),
  },
  titleText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  toggle: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: space(3),
  },
})
