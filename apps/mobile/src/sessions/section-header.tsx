import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Icon } from '../components/icon'
import { useTheme } from '../theme/use-theme'
import { ESectionKind, type ISessionSection } from './session-sections'

export const SectionHeader = ({
  section,
  onToggle,
}: {
  section: ISessionSection
  onToggle: (kind: ESectionKind) => void
}) => {
  const theme = useTheme()
  const rule = <View style={[styles.rule, { backgroundColor: theme.border }]} />
  if (section.kind === ESectionKind.Project) {
    return (
      <View style={styles.header}>
        <Icon ios="folder" web="folder" color={theme.foreground} size={18} />
        <Text numberOfLines={1} style={[styles.project, { color: theme.foreground }]}>
          {section.title}
        </Text>
        {rule}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: section.expanded }}
      onPress={() => onToggle(section.kind)}
      style={({ pressed }) => [styles.header, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon
        ios={section.expanded ? 'chevron.down' : 'chevron.right'}
        web={section.expanded ? 'expand_more' : 'chevron_right'}
        color={theme.mutedForeground}
        size={14}
      />
      <Text style={[styles.folded, { color: theme.mutedForeground }]}>{section.title}</Text>
      {rule}
      <Text style={[styles.count, { color: theme.mutedForeground }]}>{section.count}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 6,
    paddingTop: 20,
  },
  project: {
    fontSize: 17,
    fontWeight: '600',
    maxWidth: '70%',
  },
  folded: {
    fontSize: 16,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  count: {
    fontSize: 14,
  },
})
