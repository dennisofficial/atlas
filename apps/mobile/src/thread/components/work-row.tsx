import { EEntryKind } from '@dltech/atlas-client/transcript'
import { space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

import type { WorkItem, WorkRow } from '../rows'
import { ToolRowView } from './tool-row'

const labelOf = (row: WorkRow): string => {
  if (row.running) return 'Working…'
  return row.elapsed.length > 0 ? `Worked for ${row.elapsed}` : 'Worked'
}

const stepsLabelOf = (count: number): string => `· ${count} ${count === 1 ? 'step' : 'steps'}`

const ItemView = ({ item }: { item: WorkItem }) => {
  if (item.kind === EEntryKind.ToolsRan) {
    return (
      <View>
        {item.run.calls.map((call) => (
          <ToolRowView key={call.callId} call={call} />
        ))}
      </View>
    )
  }
  return (
    <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.thought}>
      {item.text}
    </Text>
  )
}

export const WorkRowView = ({ row }: { row: WorkRow }) => {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(row.running)
  const label = labelOf(row)
  const handlePress = () => setExpanded((open) => !open)

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${stepsLabelOf(row.stepCount)}`}
        accessibilityHint={expanded ? 'Hides the steps' : 'Shows the steps'}
        accessibilityState={{ expanded }}
        onPress={handlePress}
        style={styles.header}
      >
        <View style={styles.glyph}>
          {row.running ? (
            <ActivityIndicator size="small" color={theme.mutedForeground} />
          ) : (
            <Icon
              icon={expanded ? ChevronDown : ChevronRight}
              color={theme.mutedForeground}
              size={16}
            />
          )}
        </View>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {label}
        </Text>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {stepsLabelOf(row.stepCount)}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.items}>
          {row.items.map((item) => (
            <ItemView key={item.id} item={item} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
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
  items: {
    gap: space(2),
    paddingLeft: space(6),
  },
  thought: {
    fontStyle: 'italic',
  },
})
