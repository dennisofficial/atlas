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
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { commandSectionsOf } from './slash-menu-model'

export const CommandListSheet = ({
  open,
  onClose,
  entries,
}: {
  open: boolean
  onClose: () => void
  entries: readonly CommandEntry[]
}) => {
  const theme = useTheme()
  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <View
        style={[styles.overlay, { backgroundColor: withAlpha({ color: '#000000', alpha: 0.35 }) }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the command list"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.popover,
              borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
            },
          ]}
        >
          <Text size={ETextRole.Sm} weight={EFontWeight.Medium} style={styles.title}>
            Commands
          </Text>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.title}>
            Type a name in the message box to run it.
          </Text>
          <ScrollView scrollsToTop={false} keyboardShouldPersistTaps="handled">
            {commandSectionsOf(entries).map((section) => (
              <View key={section.group}>
                <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.group}>
                  {section.group}
                </Text>
                {section.entries.map((entry) => (
                  <View key={`${entry.kind}:${entry.name}`} style={styles.entry}>
                    <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
                      /{entry.name}
                    </Text>
                    {entry.argumentHint === undefined ? null : (
                      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                        {entry.argumentHint}
                      </Text>
                    )}
                    <Text
                      size={ETextRole.Xs}
                      tone={ETextTone.Muted}
                      numberOfLines={1}
                      style={styles.summary}
                    >
                      {entry.summary}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    padding: space(3),
  },
  sheet: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    elevation: 8,
    maxHeight: 460,
    maxWidth: 480,
    padding: space(2),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  title: {
    paddingHorizontal: space(1),
  },
  group: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
    paddingTop: space(2),
  },
  entry: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(1),
    paddingVertical: space(1),
  },
  summary: {
    flex: 1,
    textAlign: 'right',
  },
})
