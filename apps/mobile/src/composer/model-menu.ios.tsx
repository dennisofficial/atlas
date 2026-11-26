import { useIsDark, useTheme } from '@dltech/atlas-ui-native'
import { Button, Host, Menu, Section, Text } from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  font,
  foregroundStyle,
  menuIndicator,
} from '@expo/ui/swift-ui/modifiers'
import { StyleSheet } from 'react-native'

import {
  type IModelMenuProps,
  modelMenuSectionsOf,
  modelMenuSelectionImageOf,
} from './model-menu-model'
import {
  type IModelOption,
  NO_MODEL_LABEL,
  modelTriggerLabelOf,
  selectionOf,
} from './model-options'

const ALL_MODELS_LABEL = 'All models…'

export const ModelMenu = ({
  models,
  selection,
  pinned,
  pinnedRef,
  defaultRow = true,
  onSelect,
  onOpenAll,
}: IModelMenuProps) => {
  const theme = useTheme()
  const dark = useIsDark()
  const label = modelTriggerLabelOf({ models, selection, ref: pinnedRef })
  const sections = modelMenuSectionsOf({ models, pinned })

  const handleModel = (model: IModelOption) => {
    const next = selectionOf({
      models,
      modelId: model.id,
      effort: selection?.effort ?? null,
      fast: selection?.fast ?? false,
    })
    if (next === null) return
    onSelect(next)
  }

  return (
    <Host
      colorScheme={dark ? 'dark' : 'light'}
      alignment="leading"
      matchContents
      style={styles.host}
    >
      <Menu
        label={
          <Text
            modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(theme.mutedForeground)]}
          >
            {label}
          </Text>
        }
        modifiers={[
          accessibilityLabel(`Model: ${label}`),
          buttonStyle('glass'),
          buttonBorderShape('capsule'),
          menuIndicator('hidden'),
        ]}
      >
        {defaultRow ? <Button label={NO_MODEL_LABEL} onPress={() => onSelect(null)} /> : null}
        {sections.map((section) => (
          <Section key={section.title} title={section.title}>
            {section.models.map((model) => (
              <Button
                key={model.id}
                label={model.label}
                systemImage={modelMenuSelectionImageOf({
                  model,
                  selectedId: selection?.model.id ?? null,
                })}
                onPress={() => handleModel(model)}
              />
            ))}
          </Section>
        ))}
        <Section>
          <Button label={ALL_MODELS_LABEL} systemImage="magnifyingglass" onPress={onOpenAll} />
        </Section>
      </Menu>
    </Host>
  )
}

const styles = StyleSheet.create({
  host: {
    flexShrink: 1,
  },
})
