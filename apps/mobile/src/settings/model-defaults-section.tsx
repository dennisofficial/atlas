import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, Switch, View } from 'react-native'
import { z } from 'zod'

import { EffortSelect } from '../composer/model-controls'
import { type IModelSelection, selectionOf } from '../composer/model-options'
import { ModelSelect } from '../composer/model-picker'
import { useModels } from '../composer/use-models'
import { usePinnedModels } from '../composer/use-pinned-models'
import { useSettings } from './settings-provider'
import { Section } from './settings-parts'

export const ModelDefaultsSection = () => {
  const settings = useSettings()
  const { models } = useModels()
  const { pinned, setPinned } = usePinnedModels()
  const personalId = settings.read({ key: 'model.id', schema: z.string() })
  const effort = settings.read({ key: 'model.effort', schema: z.string() })
  const fast = settings.read({ key: 'model.fast', schema: z.boolean() })
  const selection = selectionOf({ models, modelId: personalId, effort, fast })
  const canGoFast = selection?.model.fast === true

  const handleSelect = (next: IModelSelection | null) => {
    if (next === null) {
      void settings.save({ 'model.id': '', 'model.fast': false }).catch(() => undefined)
      return
    }
    void settings
      .save({ 'model.id': next.model.id, 'model.effort': next.effort, 'model.fast': next.fast })
      .catch(() => undefined)
  }

  const handleEffort = (name: string) => {
    void settings.save({ 'model.effort': name }).catch(() => undefined)
  }

  const handleFast = (next: boolean) => {
    void settings.save({ 'model.fast': next }).catch(() => undefined)
  }

  return (
    <Section title="Model">
      <CardRow>
        <View style={styles.control}>
          <Text size={ETextRole.Sm}>Default model</Text>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
            Sessions that do not pick their own
          </Text>
        </View>
        <ModelSelect
          models={models}
          selection={selection}
          pinned={pinned}
          personalId=""
          onPinnedChange={setPinned}
          onSelect={handleSelect}
        />
      </CardRow>
      {selection === null ? null : (
        <CardRow>
          <View style={styles.control}>
            <Text size={ETextRole.Sm}>Effort</Text>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              How hard the model thinks by default
            </Text>
          </View>
          <EffortSelect selection={selection} onChange={handleEffort} />
        </CardRow>
      )}
      {canGoFast ? (
        <CardRow>
          <View style={styles.control}>
            <Text size={ETextRole.Sm}>Fast</Text>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Prefer the faster variant of the model
            </Text>
          </View>
          <Switch accessibilityLabel="Fast" value={fast} onValueChange={handleFast} />
        </CardRow>
      ) : null}
    </Section>
  )
}

const styles = StyleSheet.create({
  control: {
    flexShrink: 1,
    gap: space(0.5),
  },
})
