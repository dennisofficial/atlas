import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { rebaseMentionReader, type DiscoveredSkill } from '@dltech/atlas-harness'

import { liveTokens, tokenAtOffset, type LiveToken } from '../ui/composer-tokens'
import { pastedTagSpans } from '@dltech/atlas-core'
import { readImageBase64 } from '../ui/clipboard-image'
import { restoredImages, submissionOf } from '../ui/draft-images'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { commandSpecs, dispatchSubmission, EDispatch, localCommands } from './commands'
import type { AtlasApp } from './compose'
import { workspaceFileLoader } from './mentioned-files'
import type { useAgentView } from './use-agent-view'
import { useComposerMenus } from './use-composer-menus'
import type { useConversation } from './use-conversation'
import { useResolvedMentions } from './use-resolved-mentions'

export function useWorkspaceComposer(args: {
  app: AtlasApp
  draft: ReturnType<typeof useDraft>
  tokens: ReturnType<typeof useDraftTokens>
  conversation: ReturnType<typeof useConversation>
  agentView: ReturnType<typeof useAgentView>
  commands: ReturnType<typeof localCommands>
  loadedSkills: readonly DiscoveredSkill[]
  handleOpenNewest: () => boolean
}) {
  const { app, draft, tokens, conversation, agentView, commands, loadedSkills, handleOpenNewest } =
    args

  const [sends, setSends] = useState(0)

  const skills = useMemo(() => loadedSkills.filter((skill) => skill.userInvocable), [loadedSkills])

  const specs = useMemo(() => commandSpecs({ commands, skills }), [commands, skills])

  const files = useMemo(
    () => rebaseMentionReader({ reader: app.files, root: conversation.projectDirectory }),
    [app.files, conversation.projectDirectory],
  )
  const currentFiles = useRef(files)
  currentFiles.current = files
  const handleMentionProblem = useCallback((reason: string) => {
    notify({ text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, key: 'mention-files' })
  }, [])

  const menus = useComposerMenus({
    specs,
    files,
    cdFiles: app.files,
    onProblem: handleMentionProblem,
    currentDirectory: conversation.projectDirectory,
    onComplete: draft.setValue,
  })
  const readDraft = useRef(menus.handleTextChanged)
  readDraft.current = menus.handleTextChanged

  useEffect(() => {
    readDraft.current(draft.value)
  }, [draft.value, files])

  const mentionSpans = useResolvedMentions({
    text: draft.value,
    files,
    onProblem: handleMentionProblem,
  })

  const cursorOffsetBefore = useRef<number | null>(null)

  const handleCursorMoved = useCallback(() => {
    const editor = draft.editor.current
    if (editor === null) return

    const offset = editor.cursorOffset
    const before = cursorOffsetBefore.current
    cursorOffsetBefore.current = offset

    const token = tokenAtOffset({ editor, offset })
    if (token === null) return

    const steppingLeft = before !== null && offset < before
    const boundary = steppingLeft ? token.start : token.end
    if (boundary === offset) return

    cursorOffsetBefore.current = boundary

    const selection = editor.getSelection()
    if (selection !== null) {
      editor.setSelection(selection.start === selection.end ? boundary : selection.start, boundary)
      return
    }

    editor.cursorOffset = boundary
  }, [draft])

  const handleAttachImage = useCallback((): boolean => {
    tokens.handleImage()
    return true
  }, [tokens])

  const [tokenSpans, setTokenSpans] = useState<readonly LiveToken[]>([])

  useEffect(() => {
    const editor = draft.editor.current
    if (editor === null) return
    setTokenSpans(liveTokens(editor))
  }, [draft])

  const highlights = useMemo(() => [...mentionSpans, ...tokenSpans], [mentionSpans, tokenSpans])

  const handleSubmit = useCallback(() => {
    void (async () => {
      const editor = draft.editor.current
      const said = editor?.plainText ?? draft.value

      await tokens.settle()
      const live = editor === null ? [] : tokens.tokens()
      const readyImages = live.flatMap((token) =>
        token.slot.kind === 'image' && token.slot.image !== null
          ? [{ ...token.slot.image, ordinal: token.slot.ordinal }]
          : [],
      )

      if (said.trim().length === 0 && live.length === 0) {
        handleOpenNewest()
        return
      }

      draft.clear()
      setSends((count) => count + 1)

      const putBackPastes = live.flatMap((token) => {
        if (token.slot.kind !== 'pasted') return []
        const span = pastedTagSpans(token.slot.label)[0]
        return span === undefined ? [] : [{ ordinal: span.ordinal, content: token.slot.content }]
      })

      const putBack = () => {
        tokens.restore({ text: said, images: readyImages, pastes: putBackPastes })
      }

      const keepAttachments = () => {
        if (readyImages.length === 0) return
        tokens.restore({
          text: draft.editor.current?.plainText ?? '',
          images: readyImages,
        })
      }

      if (agentView.addressing !== null) {
        const spoken = submissionOf({ text: said, tokens: live, load: readImageBase64 })
        void agentView.handleSay(spoken).then((refusal) => {
          if (refusal === null) return

          putBack()
          conversation.handleReportProblem(refusal)
        })
        return
      }

      const ownerBinding = app.sessionOwner.snapshot().binding
      void dispatchSubmission({
        text: said,
        commands,
        skills,
        working: conversation.working,
        loadFile: workspaceFileLoader(files),
      }).then((dispatched) => {
        if (dispatched.type === EDispatch.Queued) {
          keepAttachments()
          conversation.handleQueueSettled(dispatched.entry)
          return
        }
        if (dispatched.type === EDispatch.Refused) {
          putBack()
          conversation.handleReportProblem(dispatched.reason)
          return
        }
        if (dispatched.type === EDispatch.Ran) {
          keepAttachments()
          if (dispatched.notice !== undefined) notify({ text: dispatched.notice })
          return
        }
        if (dispatched.type !== EDispatch.Send) return
        if (
          currentFiles.current !== files ||
          app.sessionOwner.snapshot().binding !== ownerBinding
        ) {
          putBack()
          conversation.handleReportProblem(
            'The session filesystem changed while preparing your message. Send it again from the current runtime.',
          )
          return
        }

        const sending = submissionOf({
          text: dispatched.text,
          tokens: live,
          load: readImageBase64,
        })
        conversation.handleSend({ ...sending, context: dispatched.drafts })
      })
    })()
  }, [
    agentView,
    app.sessionOwner,
    commands,
    conversation,
    draft,
    files,
    handleOpenNewest,
    skills,
    tokens,
  ])

  const draftIsEmpty = useCallback(
    (): boolean => (draft.editor.current?.plainText ?? draft.value).length === 0,
    [draft],
  )

  const takingBack = useRef(false)
  const handleTakeBackPending = useCallback((): boolean => {
    if (takingBack.current) return false

    const taken = conversation.handleTakeBackPending()
    if (taken instanceof Promise) {
      takingBack.current = true
      void taken
        .then((said) => {
          takingBack.current = false
          if (said === null) return
          tokens.restore({
            text: said.text,
            images: restoredImages({ images: said.images, text: said.text }),
          })
        })
        .catch(() => {
          takingBack.current = false
        })
      return true
    }

    if (taken === null) return false
    tokens.restore({
      text: taken.text,
      images: restoredImages({ images: taken.images, text: taken.text }),
    })
    return true
  }, [conversation, tokens])

  return {
    sends,
    menus,
    highlights,
    handleCursorMoved,
    handleAttachImage,
    handleSubmit,
    handleTakeBackPending,
    draftIsEmpty,
  }
}
