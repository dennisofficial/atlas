import { ETextRole, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { EffortGauge } from './effort-gauge'
import { effortChoicesOf, effortLabelOf, type IModelSelection } from './model-options'
import { COMPOSER_TRIGGER_INSET } from '../thread/composer/composer-shape'

export const EffortSelect = ({
  selection,
  onChange,
}: {
  selection: IModelSelection
  onChange: (effort: string) => void
}) => {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const efforts = effortChoicesOf(selection)

  const handlePick = (effort: string) => {
    onChange(effort)
    setOpen(false)
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Effort: ${effortLabelOf(selection.effort)}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
      >
        <EffortGauge efforts={efforts} effort={selection.effort} color={theme.mutedForeground} />
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View
          style={[
            styles.overlay,
            { backgroundColor: withAlpha({ color: '#000000', alpha: 0.35 }) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the effort menu"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.menu,
              {
                backgroundColor: theme.popover,
                borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
              },
            ]}
          >
            <ScrollView scrollsToTop={false} keyboardShouldPersistTaps="handled">
              {efforts.map((effort) => (
                <Pressable
                  key={effort}
                  accessibilityRole="button"
                  accessibilityLabel={effortLabelOf(effort)}
                  accessibilityState={{ selected: effort === selection.effort }}
                  onPress={() => handlePick(effort)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed ? { backgroundColor: theme.accent } : null,
                  ]}
                >
                  <Text size={ETextRole.Sm} style={styles.rowLabel}>
                    {effortLabelOf(effort)}
                  </Text>
                  {effort === selection.effort ? (
                    <Icon icon={Check} color={theme.foreground} size={16} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    padding: space(3),
  },
  menu: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    elevation: 8,
    maxHeight: 320,
    maxWidth: 480,
    padding: space(1),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  row: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  rowLabel: {
    flex: 1,
  },
})
