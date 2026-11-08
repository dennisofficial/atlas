import { classify, ECallState, type ToolCall } from '@dltech/atlas-client/transcript'
import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  EFontFamily,
  ETextRole,
  ETextTone,
  Icon,
  Separator,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { Check, CircleAlert } from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native'

const OUTPUT_MAX_HEIGHT = 240

const isOpen = (call: ToolCall): boolean =>
  call.state === ECallState.Pending || call.state === ECallState.AwaitingApproval

export const ToolRowView = ({ call }: { call: ToolCall }) => {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)
  const { line, note, failed } = classify({ call, cwd: '' })
  const output = call.liveOutput ?? call.modelText
  const hasOutput = output.length > 0
  const handlePress = () => setExpanded((open) => !open)

  const glyph = isOpen(call) ? (
    <ActivityIndicator size="small" color={theme.mutedForeground} />
  ) : (
    <Icon
      icon={failed ? CircleAlert : Check}
      color={failed ? theme.destructive : theme.mutedForeground}
      size={14}
    />
  )

  const header = (
    <>
      <View style={styles.glyph}>{glyph}</View>
      <Text
        size={ETextRole.Sm}
        tone={failed ? ETextTone.Destructive : ETextTone.Muted}
        numberOfLines={1}
        style={styles.line}
      >
        {line}
      </Text>
      {note.length > 0 ? (
        <Text
          size={ETextRole.Xs}
          tone={ETextTone.Muted}
          family={EFontFamily.Mono}
          numberOfLines={1}
        >
          {note}
        </Text>
      ) : null}
    </>
  )

  return (
    <View>
      {hasOutput ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${line}, ${expanded ? 'hide' : 'show'} output`}
          accessibilityState={{ expanded }}
          onPress={handlePress}
          style={styles.header}
        >
          {header}
        </Pressable>
      ) : (
        <View style={styles.header}>{header}</View>
      )}
      {hasOutput && expanded ? (
        <View style={styles.output}>
          <Separator />
          <ScrollView
            nestedScrollEnabled
            style={[styles.box, { backgroundColor: theme.muted }]}
            contentContainerStyle={styles.boxContent}
          >
            <Text size={ETextRole.Xs} family={EFontFamily.Mono} selectable>
              {output}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius(0.8),
    maxHeight: OUTPUT_MAX_HEIGHT,
  },
  boxContent: {
    padding: space(3),
  },
  glyph: {
    alignItems: 'center',
    width: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    minHeight: 44,
  },
  line: {
    flexShrink: 1,
  },
  output: {
    gap: space(2),
    paddingBottom: space(2),
  },
})
