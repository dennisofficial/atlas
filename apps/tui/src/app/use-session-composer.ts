import type { KeyEvent, TextareaRenderable } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DEFAULT_IMAGE_TIER, type Attachment, type SaidUpload } from '@dltech/atlas-core'

import { readClipboardImage } from '../ui/clipboard-image'
import { liveTokens, tokenAtOffset, type LiveToken } from '../ui/composer-tokens'
import type { HighlightSpan } from '../ui/components/composer'
import type { FileMenuState } from '../ui/file-menu-model'
import type { DraftControls } from '../ui/hooks/use-draft'
import { useDraft } from '../ui/hooks/use-draft'
import { useDraftTokens, type DraftTokens } from '../ui/hooks/use-draft-tokens'
import { useComposerPaste } from '../ui/hooks/use-composer-paste'
import { useFileMenu } from '../ui/hooks/use-file-menu'
import { useComposerDraft } from './use-composer-draft'
import { draftSubmissionOf } from './draft-submission'
import { pasteDirectoryOf } from './paste-directory'
import type { SessionApi } from './session-api'
import { sessionFilesOf } from './session-files'
import type { SessionAttachments } from './use-session-attachments'
import type { SessionSend } from './use-session-send'

export type SessionComposer = {
  draft: DraftControls
  tokens: DraftTokens
  fileMenu: FileMenuState | null
  highlights: readonly HighlightSpan[]
  handleKey: (key: KeyEvent) => boolean
  handleTextChanged: (text: string) => void
  handleCursorMoved: () => void
  handleAttachImage: () => void
  handleSubmit: () => void
  handleTakeBackPending: () => boolean
  draftIsEmpty: () => boolean
}

const NO_SPANS: readonly HighlightSpan[] = []

export function useSessionComposer(args: {
  api: SessionApi
  sessionId: string | null
  attachments: SessionAttachments
  send: SessionSend
  onProblem: (reason: string) => void
  onSendWithoutSession?:
    | ((message: {
        text: string
        media: readonly Attachment[]
        uploads: readonly SaidUpload[]
      }) => void)
    | undefined
}): SessionComposer {
  const { api, sessionId, attachments, send, onProblem } = args
  const draft = useDraft()

  const directory = useMemo(
    () =>
      sessionId === null
        ? null
        : pasteDirectoryOf({ env: process.env, home: process.env.HOME ?? '', sessionId }),
    [sessionId],
  )

  const tokens = useDraftTokens({
    editor: draft.editor,
    read: readClipboardImage,
    directory: directory ?? '',
    tier: DEFAULT_IMAGE_TIER,
  })

  const files = useMemo(
    () => (sessionId === null ? undefined : sessionFilesOf({ api, sessionId })),
    [api, sessionId],
  )

  const fileMenu = useFileMenu({ reader: files, onComplete: draft.setValue, onProblem })

  useComposerDraft({
    api,
    scope: sessionId,
    value: draft.value,
    editor: draft.editor,
    tokens,
  })

  const [spans, setSpans] = useState<readonly HighlightSpan[]>(NO_SPANS)

  const handleTextChanged = useCallback(
    (_text: string) => {
      const editor = draft.editor.current
      setSpans(
        editor === null
          ? NO_SPANS
          : liveTokens(editor).map((token) => ({ start: token.start, end: token.end })),
      )
    },
    [draft.editor],
  )

  useEffect(() => {
    const editor = draft.editor.current
    setSpans(
      editor === null
        ? NO_SPANS
        : liveTokens(editor).map((token) => ({ start: token.start, end: token.end })),
    )
  }, [draft.editor, draft.value])

  const cursorBefore = useRef<number | null>(null)

  const handleCursorMoved = useCallback(() => {
    const editor = draft.editor.current
    if (editor === null) return

    const offset = editor.cursorOffset
    const before = cursorBefore.current
    cursorBefore.current = offset

    const token = tokenAtOffset({ editor, offset })
    if (token === null) return

    const boundary = before !== null && offset < before ? token.start : token.end
    if (boundary === offset) return

    cursorBefore.current = boundary
    editor.cursorOffset = boundary
  }, [draft.editor])

  const attached = useRef(new Set<string>())

  const handleAttachImage = useCallback(() => {
    tokens.handleImage()
    void tokens.settle().then(() => {
      const editor: TextareaRenderable | null = draft.editor.current
      if (editor === null) return
      const fresh = liveTokens(editor).flatMap((token) => {
        if (token.slot.kind !== 'image' || token.slot.image === null) return []
        if (attached.current.has(token.slot.image.path)) return []
        attached.current.add(token.slot.image.path)
        return [token.slot.image]
      })
      if (fresh.length > 0) attachments.attachImages(fresh)
    })
  }, [attachments, draft.editor, tokens])

  useComposerPaste({
    overlaid: false,
    tokens,
    handleAttachImage: () => {
      handleAttachImage()
      return true
    },
  })

  const preparing = useRef<string | null>(null)
  const consume = useRef({ attachments, send })
  consume.current = { attachments, send }

  const handleSubmit = useCallback(() => {
    const attempt = draft.editor.current?.plainText ?? draft.value
    if (preparing.current === attempt) return
    preparing.current = attempt

    void (async () => {
      await tokens.settle()
      const live: LiveToken[] = tokens.tokens()
      const submission = draftSubmissionOf({ text: attempt, tokens: live })

      if (submission.text === '' && submission.images.length === 0) return
      if (!consume.current.attachments.checkSendable()) {
        onProblem('the picture is still uploading')
        return
      }

      const { media, uploads } = consume.current.attachments.payload()
      const putBack = () => {
        tokens.restore({ text: submission.text, images: submission.images })
      }

      draft.clear()
      attached.current.clear()
      consume.current.attachments.sent()

      if (sessionId === null) {
        args.onSendWithoutSession?.({ text: submission.text, media, uploads })
        return
      }

      const posted = await consume.current.send.handleSend({
        text: submission.text,
        media,
        uploads,
      })
      if (!posted) putBack()
    })()
      .catch((failure: unknown) => {
        onProblem(failure instanceof Error ? failure.message : 'Could not prepare the message')
      })
      .finally(() => {
        preparing.current = null
      })
  }, [args, draft, onProblem, sessionId, tokens])

  const handleKey = useCallback((key: KeyEvent): boolean => fileMenu.handleKey(key), [fileMenu])

  const draftIsEmpty = useCallback(
    (): boolean => (draft.editor.current?.plainText ?? draft.value).length === 0,
    [draft],
  )

  return {
    draft,
    tokens,
    fileMenu: fileMenu.state,
    highlights: spans,
    handleKey,
    handleTextChanged,
    handleCursorMoved,
    handleAttachImage,
    handleSubmit,
    handleTakeBackPending: () => false,
    draftIsEmpty,
  }
}
