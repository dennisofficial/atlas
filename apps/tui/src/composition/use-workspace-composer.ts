import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DiscoveredSkill } from '@dltech/atlas-harness'

import { liveTokens, tokenAtOffset, type LiveToken } from '../ui/composer-tokens'
import { mentionedFilePaths, pastedTagSpans } from '@dltech/atlas-core'
import { readImageBase64 } from '../ui/clipboard-image'
import { restoredImages, submissionOf } from '../ui/draft-images'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { notify } from '../ui/notice-store'
import { commandSpecs, dispatchSubmission, EDispatch, localCommands } from './commands'
import type { AtlasApp } from './compose'
import { workspaceFileLoader } from './mentioned-files'
import {
  beginMentionPreparation,
  finishMentionPreparation,
  reportMentionProblem,
} from './mention-notices'
import type { useAgentView } from './use-agent-view'
import { useComposerMenus } from './use-composer-menus'
import type { useConversation } from './use-conversation'
import { useResolvedMentions } from './use-resolved-mentions'
import { useComposerFiles } from './use-composer-files'

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

  const { reader, files } = useComposerFiles({
    app,
    projectDirectory: conversation.projectDirectory,
  })
  const currentFiles = useRef(files)
  currentFiles.current = files

  const menus = useComposerMenus({
    specs,
    files,
    cdFiles: reader,
    onProblem: reportMentionProblem,
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
    onProblem: reportMentionProblem,
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

  const preparing = useRef<{ text: string } | null>(null)
  const handleSubmit = useCallback(() => {
    const attempt = { text: draft.editor.current?.plainText ?? draft.value }
    if (preparing.current?.text === attempt.text) return
    preparing.current = attempt
    void (async () => {
      const editor = draft.editor.current
      const said = attempt.text

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

      const clearDraft = () => {
        if (
          preparing.current !== attempt ||
          (draft.editor.current?.plainText ?? draft.value) !== said
        )
          return
        draft.clear()
        setSends((count) => count + 1)
      }

      const putBackPastes = live.flatMap((token) => {
        if (token.slot.kind !== 'pasted') return []
        const span = pastedTagSpans(token.slot.label)[0]
        return span === undefined ? [] : [{ ordinal: span.ordinal, content: token.slot.content }]
      })

      const putBack = () => {
        tokens.restore({ text: said, images: readyImages, pastes: putBackPastes })
      }

      const keepAttachments = () => {
        if (preparing.current !== attempt || readyImages.length === 0) return
        tokens.restore({
          text: draft.editor.current?.plainText ?? '',
          images: readyImages,
        })
      }

      if (agentView.addressing !== null) {
        clearDraft()
        const spoken = submissionOf({ text: said, tokens: live, load: readImageBase64 })
        void agentView.handleSay(spoken).then((refusal) => {
          if (refusal === null) return

          putBack()
          conversation.handleReportProblem(refusal)
        })
        return
      }

      const ownerBinding = app.sessionOwner.snapshot().binding
      if (mentionedFilePaths(said).length > 0) beginMentionPreparation()
      const dispatched = await dispatchSubmission({
        text: said,
        commands,
        skills,
        working: conversation.working,
        loadFile: workspaceFileLoader(files),
      })
      if (dispatched.type === EDispatch.Queued) {
        clearDraft()
        keepAttachments()
        conversation.handleQueueSettled(dispatched.entry)
        return
      }
      if (dispatched.type === EDispatch.Refused) {
        conversation.handleReportProblem(dispatched.reason)
        return
      }
      if (dispatched.type === EDispatch.Ran) {
        clearDraft()
        keepAttachments()
        if (dispatched.notice !== undefined) notify({ text: dispatched.notice })
        return
      }
      if (dispatched.type !== EDispatch.Send || preparing.current !== attempt) return
      if (
        currentFiles.current !== files ||
        app.sessionOwner.snapshot().binding !== ownerBinding ||
        app.sessionOwner.placement.moveFor(conversation.threadId) !== null
      ) {
        conversation.handleReportProblem(
          'The session filesystem changed while preparing your message. Send it again from the current runtime.',
        )
        return
      }

      if ((draft.editor.current?.plainText ?? draft.value) !== said) {
        conversation.handleReportProblem(
          'The draft changed while reading mentioned files. Send it again when ready.',
        )
        return
      }
      clearDraft()
      const sending = submissionOf({
        text: dispatched.text,
        tokens: live,
        load: readImageBase64,
      })
      conversation.handleSend({ ...sending, context: dispatched.drafts })
    })()
      .catch((error: unknown) => {
        conversation.handleReportProblem(
          error instanceof Error ? error.message : 'Could not prepare the message',
        )
      })
      .finally(() => {
        if (preparing.current !== attempt) return
        preparing.current = null
        finishMentionPreparation()
      })
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
