import { decodeSettingValue, EConfigLayer, type LayeredSettingLayer } from '@dltech/atlas-wire/web'
import {
  diskValueToSave,
  sandboxDiskOptionsOf,
  sandboxSizeOptionsOf,
  savedDiskValueOf,
  savedSizeValueOf,
  SANDBOX_DISK_TITLE,
  SANDBOX_SETTING_KEYS,
  SANDBOX_SIZE_TITLE,
  sizeValueToSave,
  type ISandboxSize,
} from '@dltech/atlas-client/settings'
import { Button } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ChoiceRow } from './choice-row'
import { Row, Section } from './settings-parts'

const LABEL_OF_KEY: Readonly<Record<string, string>> = {
  'sandbox.vcpus': 'vCPUs',
  'sandbox.memoryGb': 'Memory (GB)',
  'sandbox.diskGb': 'Disk (GB)',
}

const TITLE_OF_LAYER: Readonly<Record<string, string>> = {
  [EConfigLayer.Personal]: 'Personal',
  [EConfigLayer.Group]: 'Group',
}

export const SizeChoice = ({
  saved,
  inherited,
  onSave,
}: {
  saved: ISandboxSize | null
  inherited: ISandboxSize
  onSave: (size: ISandboxSize | null) => Promise<void>
}) => {
  const initial = savedSizeValueOf({ value: saved, withAccountDefault: true })
  const [selected, setSelected] = useState(initial)
  const [saving, setSaving] = useState(false)
  const options = sandboxSizeOptionsOf({ inherited, withAccountDefault: true })

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(sizeValueToSave({ selected, withAccountDefault: true }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.form}>
      <Section title={SANDBOX_SIZE_TITLE}>
        <ChoiceRow label="Size" value={selected} options={options} onChange={setSelected} />
      </Section>
      <Button
        label="Save size"
        loading={saving}
        disabled={selected === initial}
        onPress={() => void handleSave()}
      />
    </View>
  )
}

export const DiskChoice = ({
  saved,
  inheritedDiskGb,
  onSave,
}: {
  saved: number | null
  inheritedDiskGb: number
  onSave: (diskGb: number | null) => Promise<void>
}) => {
  const initial = savedDiskValueOf({ diskGb: saved, withAccountDefault: true })
  const [selected, setSelected] = useState(initial)
  const [saving, setSaving] = useState(false)
  const options = sandboxDiskOptionsOf({ inheritedDiskGb, withAccountDefault: true })

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(diskValueToSave({ selected, withAccountDefault: true }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.form}>
      <Section title={SANDBOX_DISK_TITLE}>
        <ChoiceRow label="Disk" value={selected} options={options} onChange={setSelected} />
      </Section>
      <Button
        label="Save disk"
        loading={saving}
        disabled={selected === initial}
        onPress={() => void handleSave()}
      />
    </View>
  )
}

export const InheritedSandboxRows = ({
  layers,
  own,
}: {
  layers: readonly LayeredSettingLayer[]
  own: EConfigLayer
}) => {
  const rows = layers
    .filter((layer) => layer.layer !== own)
    .flatMap((layer) =>
      layer.values
        .filter((value) => SANDBOX_SETTING_KEYS.includes(value.key))
        .map((value) => ({
          id: `${layer.layer}:${value.key}`,
          label: `${TITLE_OF_LAYER[layer.layer] ?? layer.layer}, ${LABEL_OF_KEY[value.key] ?? value.key}`,
          value: String(decodeSettingValue(value.value)),
        })),
    )
  if (rows.length === 0) return null
  return (
    <Section title="Inherited">
      {rows.map((row) => (
        <Row key={row.id} label={row.label} value={row.value} mono />
      ))}
    </Section>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: space(2),
  },
})
