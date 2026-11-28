import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import type { CommandEntry } from '@dltech/atlas-commands'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { commandSectionsOf } from './slash-menu-model'

const Candidate = ({
  entry,
  onPick,
}: {
  entry: CommandEntry
  onPick: (entry: CommandEntry) => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`/${entry.name}`}
      onPress={() => onPick(entry)}
      style={({ pressed }) => [
        styles.candidate,
        {
          backgroundColor: pressed
            ? withAlpha({ color: theme.foreground, alpha: 0.06 })
            : undefined,
        },
      ]}
    >
      <Text size={ETextRole.Sm} family={EFontFamily.Mono} weight={EFontWeight.Medium}>
        /{entry.name}
      </Text>
      {entry.argumentHint === undefined ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
          {entry.argumentHint}
        </Text>
      )}
      <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} style={styles.summary}>
        {entry.summary}
      </Text>
    </Pressable>
  )
}

export const SlashMenu = ({
  entries,
  onPick,
}: {
  entries: readonly CommandEntry[]
  onPick: (entry: CommandEntry) => void
}) => {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.menu,
        {
          backgroundColor: theme.card,
          borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
        },
      ]}
    >
      <ScrollView scrollsToTop={false} keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {commandSectionsOf(entries).map((section) => (
          <View key={section.group}>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
              {section.group}
            </Text>
            {section.entries.map((entry) => (
              <Candidate key={`${entry.kind}:${entry.name}`} entry={entry} onPick={onPick} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  menu: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    marginBottom: space(2),
    overflow: 'hidden',
  },
  scroll: {
    maxHeight: 240,
  },
  group: {
    paddingBottom: space(1),
    paddingHorizontal: space(2),
    paddingTop: space(2),
  },
  candidate: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  summary: {
    flex: 1,
    textAlign: 'right',
  },
})
