import { clientActionOfEntries, EClientAction, type CommandEntry } from '@dltech/atlas-commands'
import { composerSendStateOf } from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { radius, readingType, space } from '@dltech/atlas-ui/tokens'
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
import { type ReactNode, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { mergeIntoDraft } from '../v2/staged-send'
import { AttachmentChips } from './attachment-chips'
import { AttachMenu } from './attach-menu'
import { PasteImageButton } from './paste-image-button'
import { hasFailed, isUploading, readyAttachments, REMOVE_FAILED_FILES } from './attachment-plan'
import { SlashMenu } from './slash-menu'
import { completedDraftOf, menuCandidatesOf, menuQueryOf, pickActionOf } from './slash-menu-model'
import type { ComposerAttachments } from './use-attachments'
import { useComposerDraft } from './use-composer-draft'

const PLACEHOLDER = 'Ask the agent to change your code...'

export const Composer = ({
  working,
  attachments,
  onSend,
  onStop,
  sendable = true,
  placeholder = PLACEHOLDER,
  autoFocus = false,
  restored,
  draftSessionId,
  refusal,
  entries = [],
  clientActions,
  joined = false,
  children,
}: {
  working: boolean
  attachments?: ComposerAttachments | undefined
  onSend: (message: { text: string; attachments: Attachment[] }) => Promise<boolean>
  onStop?: (() => void) | undefined
  sendable?: boolean
  placeholder?: string
  autoFocus?: boolean
  restored?: { token: number; text: string } | undefined
  draftSessionId?: string | null | undefined
  refusal?: string | undefined
  entries?: readonly CommandEntry[]
  clientActions?: Record<EClientAction, () => void> | undefined
  joined?: boolean
  children?: ReactNode
}) => {
  const theme = useTheme()
  const dark = useIsDark()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const { handleSent } = useComposerDraft({
    sessionId: draftSessionId,
    text: draft,
    attachments: attachments?.attachments ?? [],
    onRestore: (restoredDraft) =>
      setDraft((current) => mergeIntoDraft({ withdrawn: restoredDraft.text, draft: current })),
  })

  const held = attachments?.held ?? []
  const sendState = composerSendStateOf({
    text: draft,
    attached: readyAttachments(held).length > 0,
    working,
    sending,
  })
  const canSend = sendable && sendState.canSend && !isUploading(held) && !hasFailed(held)
  const showsStop = sendState.showsStop && onStop !== undefined
  const candidates = menuCandidatesOf({ draft, entries })

  useEffect(() => {
    if (restored === undefined) return
    setDraft((current) => mergeIntoDraft({ withdrawn: restored.text, draft: current }))
  }, [restored])

  const handleSend = async () => {
    if (!canSend) return
    if (clientActions !== undefined) {
      const action = clientActionOfEntries({ text: draft, entries })
      if (action !== null) {
        clientActions[action]()
        setDraft('')
        handleSent(draft)
        return
      }
    }
    setSending(true)
    setFailed(false)
    const text = draft.trim()
    const sent = await onSend({ text, attachments: attachments?.attachments ?? [] })
    setSending(false)
    if (!sent) {
      setFailed(true)
      return
    }
    setDraft('')
    handleSent(text)
    attachments?.clear()
  }

  const notice = failed
    ? 'That message could not be sent.'
    : (refusal ??
      attachments?.notice ??
      (attachments?.failed === true ? REMOVE_FAILED_FILES : null))

  const handleCommand = (entry: CommandEntry) => {
    const action = pickActionOf(entry)
    if (action !== null && clientActions !== undefined) {
      clientActions[action]()
      setDraft('')
      handleSent(draft)
      return
    }
    setDraft(completedDraftOf(entry.name))
  }

  const handlePick = (pick: () => Promise<void>) => {
    setChoosing(false)
    void pick()
  }

  return (
    <View style={[styles.dock, joined ? styles.joinedDock : null]}>
      {menuQueryOf(draft) === null || candidates.length === 0 ? null : (
        <SlashMenu entries={candidates} onPick={handleCommand} />
      )}
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
          joined ? styles.joinedField : null,
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
          autoFocus={autoFocus}
          editable={!sending}
          placeholder={placeholder}
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
          {attachments === undefined ? null : (
            <PasteImageButton onImage={(data) => void attachments.pasteImage(data)} />
          )}
          {children === undefined ? null : (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.slot}
              contentContainerStyle={styles.slotContent}
            >
              {children}
            </ScrollView>
          )}
          {showsStop ? (
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
              label={sending ? 'Sending…' : 'Send'}
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
  joinedDock: {
    paddingTop: 0,
  },
  joinedField: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
  },
  input: {
    fontFamily: 'Geist_400Regular',
    fontSize: readingType.body.fontSize,
    lineHeight: readingType.body.lineHeight,
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
  slot: {
    flex: 1,
    minWidth: 0,
  },
  slotContent: {
    alignItems: 'center',
    gap: space(1),
    paddingRight: space(1),
  },
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
