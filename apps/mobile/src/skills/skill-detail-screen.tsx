import {
  defaultSkillPath,
  buildSkillTree,
  formatBytes,
  skillDetailIsReadOnly,
  type SkillTreeNode,
} from '@dltech/atlas-client/settings'
import { Card, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { SkillFileMeta } from '@dltech/atlas-wire/web'
import { router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useContentWidth } from '../layout/use-content-width'
import { pushedHeaderOptionsOf } from '../navigation/header-options'
import { useAuth } from '../auth/auth-provider'
import { EResourceState } from '../settings/api-resource-state'
import { confirmAction } from '../settings/confirm-action'
import { ActionRow, EActionTone, Section, StatusRows } from '../settings/settings-parts'
import { SettingsScroll } from '../settings/settings-scroll'
import { useApiResource } from '../settings/use-api-resource'
import { downloadSkillFile } from './download-skill-file'
import { ESkillFileAction } from './skill-file-actions'
import { SkillFileTree } from './skill-file-tree'
import { skillFilesApi, type SkillFilesApi, type SkillTarget } from './skill-files-api'
import { sha256HexOfBase64 } from './skill-hash'
import { skillFileFormRouteOf, skillsRouteOf } from './skill-routes'
import { SkillTextEditor } from './skill-text-editor'
import { useReloadOnFocus } from './use-reload-on-focus'

export const SkillDetailScreen = ({ target }: { target: SkillTarget }) => {
  const barWidth = useContentWidth()
  const { api } = useAuth()
  const files = useMemo(
    () => (api ? skillFilesApi({ api, target, hashOf: sha256HexOfBase64 }) : null),
    [api, target.scope, target.projectId, target.groupId, target.skill],
  )
  const resource = useApiResource({ load: async () => (files ? files.list() : []), deps: [files] })
  useReloadOnFocus(resource.reload)
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const [editorBusy, setEditorBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const metas = resource.data ?? []
  const readOnly = skillDetailIsReadOnly(metas)
  const currentPath = metas.some((file) => file.path === selected)
    ? selected
    : defaultSkillPath({ metas })
  const current = metas.find((file) => file.path === currentPath)
  const ready = resource.state === EResourceState.Ready && files !== null

  const handleProceed = (work: () => void) => {
    if (busy || editorBusy) return
    if (!dirty) {
      work()
      return
    }
    confirmAction({
      title: 'Discard changes?',
      message: 'The current file has unsaved changes.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => {
        setDirty(false)
        setEditorVersion((value) => value + 1)
        work()
      },
    })
  }
  const handleWork = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setFailure(null)
    try {
      await work()
    } catch {
      setFailure('The file action failed. Try again.')
    } finally {
      resource.reload()
      setBusy(false)
    }
  }
  const handleAction = ({ action, node }: { action: ESkillFileAction; node: SkillTreeNode }) => {
    if (!files || readOnly) return
    handleProceed(() => {
      if (action !== ESkillFileAction.Delete) {
        router.push(skillFileFormRouteOf({ target, action, path: node.path, folder: node.folder }))
        return
      }
      confirmAction({
        title: `Delete ${node.name}?`,
        message: 'This removes the file or folder and its contents. This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => void handleWork(() => files.remove({ path: node.path })),
      })
    })
  }
  const handleCreate = (action: ESkillFileAction) =>
    handleProceed(() => router.push(skillFileFormRouteOf({ target, action })))
  const handleDeleteSkill = () => {
    if (!files || readOnly) return
    handleProceed(() =>
      confirmAction({
        title: `Delete ${target.skill}?`,
        message: 'This removes the skill and every file in it. This cannot be undone.',
        confirmLabel: 'Delete skill',
        destructive: true,
        onConfirm: () =>
          void handleWork(async () => {
            await files.removeSkill()
            router.replace(skillsRouteOf(target))
          }),
      }),
    )
  }
  const handleDownload = () => {
    if (!files || !current) return
    void handleWork(async () => {
      const remote = await files.read({ path: current.path })
      await downloadSkillFile(remote)
    })
  }

  return (
    <SettingsScroll>
      <Stack.Screen options={pushedHeaderOptionsOf({ title: target.skill, barWidth })} />
      <StatusRows
        state={resource.state}
        onRetry={resource.reload}
        failure="Skill files could not be loaded."
      />
      {ready && metas.length === 0 ? (
        <Card>
          <Text size={ETextRole.Sm}>
            No files in this skill. Add a file or return to the skills list.
          </Text>
        </Card>
      ) : null}
      {readOnly ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Built-in skill · Read-only. Create a skill with the same name to override it.
        </Text>
      ) : null}
      {ready ? (
        <>
          <Section title="Files">
            <SkillFileTree
              nodes={buildSkillTree(metas.map((file) => file.path))}
              selected={currentPath}
              readOnly={readOnly}
              onSelect={(path) => handleProceed(() => setSelected(path))}
              onAction={handleAction}
            />
            {readOnly ? null : (
              <>
                <ActionRow
                  label="New file"
                  loading={busy}
                  onPress={() => handleCreate(ESkillFileAction.NewFile)}
                />
                <ActionRow
                  label="New folder"
                  loading={busy}
                  onPress={() => handleCreate(ESkillFileAction.NewFolder)}
                />
                <ActionRow
                  label="Upload file"
                  loading={busy}
                  onPress={() => handleCreate(ESkillFileAction.Upload)}
                />
              </>
            )}
          </Section>
          {current ? (
            current.isText ? (
              <SkillTextContent
                key={`${current.path}:${current.revision}:${editorVersion}`}
                file={current}
                files={files}
                readOnly={readOnly}
                onDirtyChange={setDirty}
                onBusyChange={setEditorBusy}
              />
            ) : (
              <Section title={current.path}>
                <View style={styles.binary}>
                  <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                    Binary file · {formatBytes(current.sizeBytes)}
                  </Text>
                </View>
                <ActionRow label="Download file" loading={busy} onPress={handleDownload} />
                {readOnly ? null : (
                  <>
                    <ActionRow
                      label="Replace file"
                      loading={busy}
                      onPress={() =>
                        handleProceed(() =>
                          router.push(
                            skillFileFormRouteOf({
                              target,
                              action: ESkillFileAction.Upload,
                              path: current.path,
                            }),
                          ),
                        )
                      }
                    />
                    <ActionRow
                      label="Delete file"
                      loading={busy}
                      onPress={() =>
                        handleAction({
                          action: ESkillFileAction.Delete,
                          node: {
                            name: current.path,
                            path: current.path,
                            folder: false,
                            children: [],
                          },
                        })
                      }
                    />
                  </>
                )}
              </Section>
            )
          ) : null}
          {readOnly ? null : (
            <Section>
              <ActionRow
                label="Delete skill"
                loading={busy}
                tone={EActionTone.Destructive}
                onPress={handleDeleteSkill}
              />
            </Section>
          )}
        </>
      ) : null}
      {failure ? (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      ) : null}
    </SettingsScroll>
  )
}

const SkillTextContent = ({
  file,
  files,
  readOnly,
  onDirtyChange,
  onBusyChange,
}: {
  file: SkillFileMeta
  files: SkillFilesApi
  readOnly: boolean
  onBusyChange: (value: boolean) => void
  onDirtyChange: (value: boolean) => void
}) => {
  const resource = useApiResource({
    load: () => files.readText({ path: file.path }),
    deps: [files, file.path],
  })
  return (
    <>
      <StatusRows
        state={resource.state}
        failure="The file could not be loaded."
        onRetry={resource.reload}
      />
      {resource.data === null ? null : (
        <SkillTextEditor
          doc={resource.data}
          path={file.path}
          files={files}
          readOnly={readOnly}
          onDirtyChange={onDirtyChange}
          onBusyChange={onBusyChange}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({ binary: { padding: space(3) } })
