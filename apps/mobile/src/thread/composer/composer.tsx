import { clientActionOfEntries, EClientAction, type CommandEntry } from '@dltech/atlas-commands'
import {
  composerSendStateOf,
  hasFailed,
  isUploading,
  readyAttachments,
  REMOVE_FAILED_FILES,
} from '@dltech/atlas-client/session'
import type { Attachment } from '@dltech/atlas-core'
import { radius, readingType, space } from '@dltech/atlas-ui/tokens'
import { ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { type PasteEventPayload, TextInputWrapper } from 'expo-paste-input'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { mergeIntoDraft } from '../session/staged-send'
import { GlassSurface } from '../../navigation/glass-surface'
import { AttachmentChips } from './attachment-chips'
import { AttachMenu } from './attach-menu'
import type { EAttachSource } from './attach-sources'
import { ComposerControls } from './composer-controls'
import { ComposerDropZone } from './composer-drop-zone'
import { pastedFileOf } from './paste-image'
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
  restored?: { token: number; text: string; attachments: readonly Attachment[] } | undefined
  draftSessionId?: string | null | undefined
  refusal?: string | undefined
  entries?: readonly CommandEntry[]
  clientActions?: Record<EClientAction, () => void> | undefined
  joined?: boolean
  children?: ReactNode
}) => {
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

  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments

  useEffect(() => {
    if (restored === undefined) return
    setDraft((current) => mergeIntoDraft({ withdrawn: restored.text, draft: current }))
    attachmentsRef.current?.restore({
      attachments: restored.attachments,
      sessionId: draftSessionId,
    })
  }, [restored, draftSessionId])

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
    >
      {children}
    </ComposerControls>
  )

  return (
    <View style={[styles.dock, joined ? styles.joinedDock : null]}>
      {menuQueryOf(draft) === null || candidates.length === 0 ? null : (
        <SlashMenu entries={candidates} onPick={handleCommand} />
      )}
      {choosing && attachments !== undefined ? <AttachMenu onPick={handlePick} /> : null}
      <GlassSurface style={styles.surface}>
        {attachments === undefined ? null : (
          <AttachmentChips held={attachments.held} onRemove={attachments.remove} />
        )}
        {notice === null ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.notice}>
            {notice}
          </Text>
        )}
        <ComposerDropZone
          style={[styles.field, joined ? styles.joinedField : null]}
          borderColor="transparent"
          onFiles={attachments?.attachFiles}
          controls={controls}
        >
          <TextInputWrapper onPaste={attachments === undefined ? undefined : handlePaste}>
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
          </TextInputWrapper>
        </ComposerDropZone>
      </GlassSurface>
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
    borderRadius: radius(2.4),
    borderWidth: 1,
    paddingHorizontal: space(2.5),
    paddingTop: space(2.5),
  },
  surface: {
    borderRadius: radius(2.4),
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
  notice: {
    paddingBottom: space(1),
    paddingHorizontal: space(1),
  },
})
