'use client'

import { Slider } from '@dltech/atlas-ui/components/slider'
import { Switch } from '@dltech/atlas-ui/components/switch'

import { ESettingFieldKind, type FieldValues, type SettingField } from '../fixtures/settings-fields'
import { SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { ConfigFooter } from './agent-config-footer'
import { ChoiceSelect } from './agent-choice-select'
import type { Draft } from '../use-draft'

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: SettingField
  value: FieldValues[string]
  onChange: (next: FieldValues[string]) => void
}) {
  switch (field.kind) {
    case ESettingFieldKind.Toggle:
      return <Switch checked={value === true} onCheckedChange={onChange} aria-label={field.title} />
    case ESettingFieldKind.Choice:
      return (
        <ChoiceSelect
          label={field.title}
          items={[...field.options]}
          value={String(value)}
          onChange={onChange}
        />
      )
    case ESettingFieldKind.Range: {
      const handleValueChange = (next: number | readonly number[]) =>
        onChange(typeof next === 'number' ? next : (next[0] ?? field.min))
      return (
        <div className="flex w-56 items-center gap-3">
          <Slider
            aria-label={field.title}
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number(value)}
            onValueChange={handleValueChange}
          />
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {value}
            {field.unit}
          </span>
        </div>
      )
    }
  }
}

export function SettingFieldRows({
  fields,
  value,
  onChange,
}: {
  fields: readonly SettingField[]
  value: FieldValues
  onChange: (next: FieldValues) => void
}) {
  return fields.map((field) => (
    <SettingsRow
      key={field.key}
      title={field.title}
      description={field.description}
      control={
        <FieldControl
          field={field}
          value={value[field.key] ?? field.fallback}
          onChange={(next) => onChange({ ...value, [field.key]: next })}
        />
      }
    />
  ))
}

export function SettingFieldsEditor({
  draft,
  title,
  description,
  fields,
}: {
  draft: Draft<FieldValues>
  title: string
  description: string
  fields: SettingField[]
}) {
  return (
    <>
      <SettingsSection title={title} description={description}>
        <SettingsCard>
          <SettingFieldRows fields={fields} value={draft.value} onChange={draft.setValue} />
        </SettingsCard>
      </SettingsSection>
      <ConfigFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />
    </>
  )
}
