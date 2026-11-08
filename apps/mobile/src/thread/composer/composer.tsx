import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import type { Attachment } from '@dltech/atlas-core'
import { ArrowUp, Paperclip, Square } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { AttachmentChips } from './attachment-chips'
import { AttachMenu } from './attach-menu'
import { REMOVE_FAILED_FILES, sendableOf } from './attachment-plan'
import type { ComposerAttachments } from './use-attachments'

export const Composer = ({
  working,
  attachments,
  onSend,
  onStop,
}: {
  working: boolean
  attachments: ComposerAttachments
  onSend: (message: { text: string; attachments: Attachment[] }) => Promise<boolean>
  onStop: () => void
}) => {
  const theme = useTheme()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [choosing, setChoosing] = useState(false)

  const canSend = sendableOf({ text: draft, held: attachments.held }) && !sending

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setFailed(false)
    const sent = await onSend({ text: draft.trim(), attachments: attachments.attachments })
    setSending(false)
    if (!sent) {
      setFailed(true)
      return
    }
    setDraft('')
    attachments.clear()
  }

  const notice = failed
    ? draft.trim().length === 0
      ? "Attachments couldn't go on their own. Add a caption to queue them for later."
      : 'That message could not be sent.'
    : (attachments.notice ?? (attachments.failed ? REMOVE_FAILED_FILES : null))

  const handlePick = (pick: () => Promise<void>) => {
    setChoosing(false)
    void pick()
  }

  return (
    <View style={styles.dock}>
      {choosing ? (
        <AttachMenu
          onPhoto={() => handlePick(attachments.pickPhotos)}
          onFile={() => handlePick(attachments.pickFiles)}
        />
      ) : null}
      <AttachmentChips held={attachments.held} onRemove={attachments.remove} />
      {notice === null ? null : (
        <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.notice}>
          {notice}
        </Text>
      )}
      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.card,
            borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
          },
        ]}
      >
        <Button
          label={choosing ? 'Close the attachment menu' : 'Attach'}
          icon={Paperclip}
          size={EButtonSize.IconSm}
          variant={choosing ? EButtonVariant.Default : EButtonVariant.Secondary}
          onPress={() => setChoosing((open) => !open)}
        />
        <Input
          bare
          multiline
          accessibilityLabel="Message Atlas"
          placeholder="Message Atlas…"
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
        />
        {working ? (
          <Button
            label="Stop"
            icon={Square}
            size={EButtonSize.IconSm}
            variant={EButtonVariant.Secondary}
            onPress={onStop}
          />
        ) : (
          <Button
            label="Send"
            icon={ArrowUp}
            size={EButtonSize.IconSm}
            disabled={!canSend}
            loading={sending}
            onPress={() => void handleSend()}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    paddingBottom: space(2),
    paddingHorizontal: space(3),
    paddingTop: space(2),
  },
  field: {
    alignItems: 'flex-end',
    borderRadius: radius(1.4),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(1.5),
    padding: space(2),
  },
  input: {
    flex: 1,
    maxHeight: 160,
    minHeight: 36,
    paddingHorizontal: space(1),
    paddingVertical: space(1),
  },
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
