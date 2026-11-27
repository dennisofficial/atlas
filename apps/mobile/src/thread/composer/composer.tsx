import { clientActionOfEntries, EClientAction, type CommandEntry } from '@dltech/atlas-commands'
import {
  composerSendStateOf,
  hasFailed,
  isUploading,
  readyAttachments,
  REMOVE_FAILED_FILES,
} from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { readingType, space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { type PasteEventPayload, TextInputWrapper } from 'expo-paste-input'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { mergeIntoDraft } from '../session/staged-send'
import { GlassSurface } from '../../navigation/glass-surface'
import { AttachmentChips } from './attachment-chips'
import { ComposerFooter } from './composer-footer'
import {
  COMPOSER_DOCK_BOTTOM,
  COMPOSER_FIELD_BORDER,
  COMPOSER_INSET,
  COMPOSER_RADIUS,
} from './composer-shape'
import { DictationField } from './dictation/dictation-field'
import { useComposerDictation } from './dictation/use-composer-dictation'
import { AttachMenu } from './attach-menu'
import type { EAttachSource } from './attach-sources'
import { ComposerControls } from './composer-controls'
import { ComposerDropZone } from './composer-drop-zone'
import { pastedFileOf } from './paste-image'
import { SlashMenu } from './slash-menu'
import { completedDraftOf, menuCandidatesOf, menuQueryOf, pickActionOf } from './slash-menu-model'
import { createSendLock } from './send-lock'
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
  trailing,
  trailingPressable = true,
  status,
  footer,
  children,
}: {
  working: boolean
  attachments?: ComposerAttachments | undefined
  onSend: (message: { text: string; attachments: Attachment[] }) => Promise<boolean>
  onStop?: (() => void) | undefined
  sendable?: boolean
  placeholder?: string
  autoFocus?: boolean
  restored?: { token: number; text: string; attachments: readonly Attachment[] } | undefined
  draftSessionId?: string | null | undefined
  refusal?: string | undefined
  entries?: readonly CommandEntry[]
  clientActions?: Record<EClientAction, () => void> | undefined
  trailing?: ReactNode
  trailingPressable?: boolean
  status?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}) => {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const dictation = useComposerDictation({ text: draft, onChangeText: setDraft })
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const sendLock = useRef(createSendLock()).current

  const { handleSent } = useComposerDraft({
    sessionId: draftSessionId,
    text: draft,
    attachments: attachments?.attachments ?? [],
    onRestore: (restoredDraft) => {
      setDraft((current) => mergeIntoDraft({ withdrawn: restoredDraft.text, draft: current }))
      attachmentsRef.current?.restore({
        attachments: restoredDraft.attachments,
        sessionId: draftSessionId,
      })
    },
  })

  const held = attachments?.held ?? []
  const sendState = composerSendStateOf({
    text: dictation.displayText,
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
    attachmentsRef.current?.restore({
      attachments: restored.attachments,
      sessionId: draftSessionId,
    })
  }, [restored, draftSessionId])

  const handleSend = async () => {
    if (!canSend || !sendLock.acquire()) return
    try {
      const spoken = dictation.active ? await dictation.finish() : draft
      if (clientActions !== undefined) {
        const action = clientActionOfEntries({ text: spoken, entries })
        if (action !== null) {
          clientActions[action]()
          setDraft('')
          handleSent(spoken)
          return
        }
      }
      setSending(true)
      setFailed(false)
      const text = spoken.trim()
      const sent = await onSend({ text, attachments: attachments?.attachments ?? [] })
      setSending(false)
      if (!sent) {
        setFailed(true)
        return
      }
      setDraft('')
      handleSent(text)
      attachments?.clear()
    } finally {
      sendLock.release()
    }
  }

  const notice =
    dictation.error ??
    (failed
      ? 'That message could not be sent.'
      : (refusal ??
        attachments?.notice ??
        (attachments?.failed === true ? REMOVE_FAILED_FILES : null)))

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

  const handlePick = (source: EAttachSource) => {
    setChoosing(false)
    void attachments?.pick(source)
  }

  const handlePaste = (payload: PasteEventPayload) => {
    if (payload.type !== 'images') return
    const at = Date.now()
    attachments?.attachFiles(payload.uris.map((uri, index) => pastedFileOf({ uri, at, index })))
  }

  const controls = (
    <ComposerControls
      attach={
        attachments === undefined
          ? undefined
          : { open: choosing, onPick: handlePick, onToggle: () => setChoosing((open) => !open) }
      }
      sending={sending}
      canSend={canSend}
      onStop={showsStop ? onStop : undefined}
      onSend={() => void handleSend()}
      trailing={trailing}
      trailingPressable={trailingPressable}
      dictation={{
        active: dictation.active,
        history: dictation.history,
        onStart: dictation.start,
        onStop: dictation.stop,
      }}
    >
      {children}
    </ComposerControls>
  )

  return (
    <View style={styles.dock}>
      {menuQueryOf(draft) === null || candidates.length === 0 ? null : (
        <SlashMenu entries={candidates} onPick={handleCommand} />
      )}
      {choosing && attachments !== undefined ? <AttachMenu onPick={handlePick} /> : null}
      <GlassSurface style={styles.surface}>
        {status}
        {attachments === undefined ? null : (
          <AttachmentChips held={attachments.held} onRemove={attachments.remove} />
        )}
        {notice === null ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.notice}>
            {notice}
          </Text>
        )}
        <ComposerDropZone
          style={styles.field}
          borderColor="transparent"
          onFiles={attachments?.attachFiles}
          controls={controls}
        >
          <TextInputWrapper onPaste={attachments === undefined ? undefined : handlePaste}>
            {dictation.active ? (
              <DictationField
                before={dictation.before}
                transcript={dictation.transcript}
                after={dictation.after}
                style={styles.dictation}
              />
            ) : (
              <Input
                bare
                multiline
                accessibilityLabel="Message Atlas"
                autoFocus={autoFocus}
                editable={!sending}
                placeholder={placeholder}
                value={draft}
                onChangeText={setDraft}
                selection={dictation.selection ?? undefined}
                onSelectionChange={(event) =>
                  dictation.handleSelection(event.nativeEvent.selection)
                }
                onFocus={dictation.handleFocus}
                onBlur={dictation.handleBlur}
                style={styles.input}
              />
            )}
          </TextInputWrapper>
        </ComposerDropZone>
      </GlassSurface>
      {footer === undefined ? null : <ComposerFooter>{footer}</ComposerFooter>}
    </View>
  )
}

const styles = StyleSheet.create({
  dock: {
    paddingBottom: COMPOSER_DOCK_BOTTOM,
    paddingHorizontal: space(4),
    paddingTop: space(2),
  },
  field: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
    borderWidth: COMPOSER_FIELD_BORDER,
    paddingHorizontal: COMPOSER_INSET,
    paddingTop: COMPOSER_INSET,
  },
  surface: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
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
  dictation: {
    fontFamily: 'Geist_400Regular',
    fontSize: readingType.body.fontSize,
    lineHeight: readingType.body.lineHeight,
  },
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
