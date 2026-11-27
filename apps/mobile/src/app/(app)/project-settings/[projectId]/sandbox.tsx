import { inheritedSandboxOf } from '@dltech/atlas-client/settings'
import { EConfigLayer, type LayeredSettingLayer, type ProjectSandbox } from '@dltech/atlas-wire/web'
import { Button, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { EResourceState } from '../../../../settings/api-resource-state'
import { DiskChoice, InheritedSandboxRows, SizeChoice } from '../../../../settings/sandbox-parts'
import { Section, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { useApiResource } from '../../../../settings/use-api-resource'

type ISandboxData = { sandbox: ProjectSandbox; layers: readonly LayeredSettingLayer[] }

const SetupScript = ({
  saved,
  onSave,
}: {
  saved: string
  onSave: (script: string) => Promise<void>
}) => {
  const [script, setScript] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const dirty = script !== saved

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(script)
      setSavedNote(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.form}>
      <Section title="Setup script">
        <View style={styles.script}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            Runs once per sandbox after the repository is cloned, before the agent starts.
          </Text>
          <Input
            value={script}
            onChangeText={setScript}
            accessibilityLabel="Setup script"
            placeholder="#!/usr/bin/env bash"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </Section>
      <Button
        label="Save setup script"
        loading={saving}
        disabled={!dirty}
        onPress={() => void handleSave()}
      />
      {savedNote && !dirty ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Setup script saved.
        </Text>
      ) : null}
    </View>
  )
}

export default function ProjectSandboxScreen() {
  const { api } = useAuth()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const { state, data, reload } = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve<ISandboxData | null>(null)
        : Promise.all([
            api.projectResources.getSandbox.query({ projectId }),
            api.projectResources.layeredSettings.query({ projectId }),
          ]).then(([sandbox, body]) => ({ sandbox, layers: body.layers })),
    deps: [api, projectId],
  })

  const handleSave = async (patch: Partial<ProjectSandbox>) => {
    if (api === undefined || data === null) return
    await api.projectResources.saveSandbox.mutate({
      projectId,
      ...data.sandbox,
      ...patch,
    })
    reload()
  }

  const sandbox = data?.sandbox
  const layers = data?.layers ?? []
  const below = inheritedSandboxOf({ layers, own: EConfigLayer.Project })

  return (
    <SettingsScroll>
      <StatusRows
        state={state}
        onRetry={reload}
        failure="The sandbox settings could not be loaded."
      />
      {state !== EResourceState.Ready || sandbox === undefined ? null : (
        <>
          <SizeChoice
            key={`size-${String(sandbox.vcpus)}-${String(sandbox.memoryGb)}`}
            saved={
              sandbox.vcpus === null ? null : { vcpus: sandbox.vcpus, memoryGb: sandbox.memoryGb }
            }
            inherited={below.size}
            onSave={(size) =>
              handleSave({ vcpus: size?.vcpus ?? null, memoryGb: size?.memoryGb ?? null })
            }
          />
          <DiskChoice
            key={`disk-${String(sandbox.diskGb)}`}
            saved={sandbox.diskGb}
            inheritedDiskGb={below.diskGb}
            onSave={(diskGb) => handleSave({ diskGb })}
          />
          <SetupScript
            key={`script-${sandbox.setupScript}`}
            saved={sandbox.setupScript}
            onSave={(setupScript) => handleSave({ setupScript })}
          />
          <InheritedSandboxRows layers={layers} own={EConfigLayer.Project} />
        </>
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  form: {
    gap: space(2),
  },
  script: {
    gap: space(2),
  },
})
