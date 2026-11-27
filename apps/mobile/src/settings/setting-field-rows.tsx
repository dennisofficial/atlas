import {
  ESettingFieldKind,
  type IFieldValues,
  type ISettingField,
} from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { SettingScalar } from '@dltech/atlas-wire/web'
import { StyleSheet, View } from 'react-native'

import { ChoiceRow } from './choice-row'
import { SwitchRow } from './switch-row'

type RangeField = Extract<ISettingField, { kind: ESettingFieldKind.Range }>

const rangeOptionsOf = (field: RangeField) =>
  Array.from({ length: Math.floor((field.max - field.min) / field.step) + 1 }, (_, index) => {
    const value = field.min + index * field.step
    return { value, label: `${value} ${field.unit}` }
  })

export const SettingFieldRows = ({
  fields,
  value,
  onChange,
}: {
  fields: readonly ISettingField[]
  value: IFieldValues
  onChange: (args: { key: string; next: SettingScalar }) => void
}) => (
  <>
    {fields.map((field) => {
      if (field.kind === ESettingFieldKind.Toggle) {
        return (
          <SwitchRow
            key={field.key}
            label={field.title}
            detail={field.description}
            value={value[field.key] === true}
            onValueChange={(next) => onChange({ key: field.key, next })}
          />
        )
      }
      if (field.kind === ESettingFieldKind.Choice) {
        return (
          <ChoiceRow
            key={field.key}
            label={field.title}
            detail={field.description}
            value={String(value[field.key] ?? field.fallback)}
            options={field.options}
            onChange={(next) => onChange({ key: field.key, next })}
          />
        )
      }
      if (field.kind === ESettingFieldKind.Range) {
        const stored = value[field.key]
        return (
          <ChoiceRow
            key={field.key}
            label={field.title}
            detail={field.description}
            value={typeof stored === 'number' ? stored : field.fallback}
            options={rangeOptionsOf(field)}
            onChange={(next) => onChange({ key: field.key, next })}
          />
        )
      }
      const stored = value[field.key]
      return (
        <CardRow key={field.key}>
          <View style={styles.copy}>
            <Text size={ETextRole.Sm}>{field.title}</Text>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              {field.description}
            </Text>
          </View>
          <Input
            accessibilityLabel={field.title}
            value={typeof stored === 'string' ? stored : field.fallback}
            placeholder={field.placeholder}
            onChangeText={(next) => onChange({ key: field.key, next })}
            style={styles.input}
          />
        </CardRow>
      )
    })}
  </>
)

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
  input: {
    minWidth: 120,
  },
})
