import type { Attachment } from '@dltech/atlas-core'
import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useIsDark,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { ArrowUp, Plus, Square } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { AttachmentChips } from './attachment-chips'
import { AttachMenu } from './attach-menu'
import { REMOVE_FAILED_FILES, sendableOf } from './attachment-plan'
import type { ComposerAttachments } from './use-attachments'

const PLACEHOLDER = 'Ask the agent to change your code...'

export const Composer = ({
  working,
  attachments,
  onSend,
  onStop,
}: {
  working: boolean
  attachments?: ComposerAttachments | undefined
  onSend: (message: { text: string; attachments: Attachment[] }) => Promise<boolean>
  onStop: () => void
}) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [choosing, setChoosing] = useState(false)

  const canSend = sendableOf({ text: draft, held: attachments?.held ?? [] }) && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const sent = await onSend({ text: draft.trim(), attachments: attachments?.attachments ?? [] })
    setSending(false)
    if (!sent) {
      setFailed(true)
      return
    }
    setDraft('')
    attachments?.clear()
  }

  const notice = failed
    ? draft.trim().length === 0
      ? "Attachments couldn't go on their own. Add a caption to queue them for later."
      : 'That message could not be sent.'
    : (attachments?.notice ?? (attachments?.failed === true ? REMOVE_FAILED_FILES : null))

  const handlePick = (pick: () => Promise<void>) => {
    setChoosing(false)
    void pick()
  }

  return (
    <View style={styles.dock}>
      {choosing && attachments !== undefined ? (
        <AttachMenu
          onPhoto={() => handlePick(attachments.pickPhotos)}
          onFile={() => handlePick(attachments.pickFiles)}
        />
      ) : null}
      {attachments === undefined ? null : (
        <AttachmentChips held={attachments.held} onRemove={attachments.remove} />
      )}
      {notice === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.notice}>
          {notice}
        </Text>
      )}
      <View
        style={[
          styles.field,
          {
            backgroundColor: dark ? withAlpha({ color: theme.input, alpha: 0.3 }) : 'transparent',
            borderColor: theme.input,
          },
        ]}
      >
        <Input
          bare
          multiline
          accessibilityLabel="Message Atlas"
          placeholder={PLACEHOLDER}
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
        />
        <View style={styles.bar}>
          {attachments === undefined ? null : (
            <Button
              label={choosing ? 'Close the attachment menu' : 'Attach a file'}
              icon={Plus}
              size={EButtonSize.Icon}
              variant={EButtonVariant.Outline}
              round
              onPress={() => setChoosing((open) => !open)}
            />
          )}
          {working ? (
            <Button
              label="Stop"
              icon={Square}
              size={EButtonSize.Icon}
              variant={EButtonVariant.Secondary}
              round
              onPress={onStop}
            />
          ) : (
            <Button
              label="Send"
              icon={ArrowUp}
              size={EButtonSize.Icon}
              round
              disabled={!canSend}
              loading={sending}
              onPress={() => void handleSend()}
            />
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    paddingBottom: space(3),
    paddingHorizontal: space(4),
    paddingTop: space(2),
  },
  field: {
    borderRadius: radius(1),
    borderWidth: 1,
    paddingHorizontal: space(2.5),
    paddingTop: space(2.5),
  },
  input: {
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 160,
    minHeight: 40,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    justifyContent: 'space-between',
    paddingBottom: space(2.5),
    paddingTop: space(1),
  },
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
