import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { DiscoveredSkill } from '@dltech/atlas-harness'

import { liveTokens, tokenAtOffset, type LiveToken } from '../ui/composer-tokens'
import { readImageBase64 } from '../ui/clipboard-image'
import { restoredImages, submissionOf } from '../ui/draft-images'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens } from '../ui/hooks/use-draft-tokens'
import { notify } from '../ui/notice-store'
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

  const menus = useComposerMenus({
    specs,
    files: app.files,
    currentDirectory: conversation.projectDirectory,
    onComplete: draft.setValue,
  })
  const readDraft = useRef(menus.handleTextChanged)
  readDraft.current = menus.handleTextChanged

  useEffect(() => {
    readDraft.current(draft.value)
  }, [draft.value])

  const mentionSpans = useResolvedMentions({ text: draft.value, files: app.files })

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

  const highlights = useMemo(
    () => [...mentionSpans, ...tokenSpans],
    [mentionSpans, tokenSpans],
  )

  const highlightedFiles = useMemo(
    () => new Set(mentionSpans.map((mention) => mention.path)),
    [mentionSpans],
  )

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

      const putBack = () => {
        draft.setValue(said)
        tokens.restore(readyImages)
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

      void dispatchSubmission({
        text: said,
        commands,
        skills,
        working: conversation.working,
        highlightedFiles,
        ...(app.files === undefined ? {} : { loadFile: workspaceFileLoader(app.files) }),
      }).then((dispatched) => {
        if (dispatched.type === EDispatch.Queued) {
          tokens.restore(readyImages)
          conversation.handleQueueSettled(dispatched.entry)
          return
        }
        if (dispatched.type === EDispatch.Refused) {
          putBack()
          conversation.handleReportProblem(dispatched.reason)
          return
        }
        if (dispatched.type === EDispatch.Ran) {
          tokens.restore(readyImages)
          if (dispatched.notice !== undefined) notify({ text: dispatched.notice })
          return
        }
        if (dispatched.type !== EDispatch.Send) return

        const sending = submissionOf({
          text: dispatched.text,
          tokens: live,
          load: readImageBase64,
        })
        conversation.handleSend({ ...sending, context: dispatched.drafts })
      })
    })()
  }, [agentView, app.files, commands, conversation, draft, handleOpenNewest, highlightedFiles, skills, tokens])

  const draftIsEmpty = useCallback(
    (): boolean => (draft.editor.current?.plainText ?? draft.value).length === 0,
    [draft],
  )

  /**
   * Cloud take-back is a round trip to the sandbox, so the draft fills from the reply rather than
   * the keypress. A concurrent second ↑ is refused while one is in flight — both would race for
   * the same queue tail and the sandbox would hand it out twice.
   */
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
          draft.setValue(said.text)
          tokens.restore(restoredImages({ images: said.images, text: said.text }))
        })
        .catch(() => {
          takingBack.current = false
        })
      return true
    }

    if (taken === null) return false
    draft.setValue(taken.text)
    tokens.restore(restoredImages({ images: taken.images, text: taken.text }))
    return true
  }, [conversation, draft, tokens])

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
