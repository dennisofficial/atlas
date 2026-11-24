import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useEffect } from 'react'

import type { SessionModelChoice } from '@dltech/atlas-protocol'

import { NoticeStack } from '../ui/components/notice-stack'
import { useProjectPrompt } from '../ui/hooks/use-project-prompt'
import { ENoticeTone, notify } from '../ui/notice-store'
import { NewSessionScreen } from './new-session-screen'
import type { GitRemote } from './new-session'
import type { SessionClient } from './session-client'
import type { SessionSend } from './use-session-send'
import { useNewSession } from './use-new-session'
import { useSessionAttachments } from './use-session-attachments'
import { useSessionComposer } from './use-session-composer'

const problemOf = (reason: string): void => {
  notify({ text: reason, tone: ENoticeTone.Warn })
}

const NO_SEND: SessionSend = {
  sending: false,
  sends: 0,
  handleSend: async () => true,
  handleStop: () => undefined,
}

export function NewSessionHost(props: {
  client: SessionClient
  cwd: string
  model: SessionModelChoice | null
  width: number
  height: number
  choosingModel: boolean
  git?: GitRemote | undefined
  onBack: () => void
  onCreated: (created: { sessionId: string; model: SessionModelChoice | null }) => void
  onKeys: (handler: (key: KeyEvent) => boolean) => void
}): React.ReactNode {
  const { api } = props.client
  const prompt = useProjectPrompt()

  const attachments = useSessionAttachments({ api, sessionId: '', onProblem: problemOf })

  const session = useNewSession({
    api,
    cwd: props.cwd,
    model: props.model,
    ask: prompt.ask,
    prompt,
    ...(props.git === undefined ? {} : { git: props.git }),
    onCreated: props.onCreated,
    onProblem: problemOf,
  })

  const composer = useSessionComposer({
    api,
    sessionId: null,
    attachments,
    send: NO_SEND,
    onProblem: problemOf,
    onSendWithoutSession: (message) => void session.handleCreate(message),
  })

  const onBack = props.onBack

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (prompt.state !== null) {
        prompt.handleKey(key)
        return true
      }
      if (composer.handleKey(key)) return true
      if (key.name === 'return') {
        composer.handleSubmit()
        return true
      }
      if (key.name === 'escape' && composer.draftIsEmpty()) {
        onBack()
        return true
      }
      return false
    },
    [composer, onBack, prompt],
  )

  const onKeys = props.onKeys
  useEffect(() => {
    onKeys(handleKey)
  }, [handleKey, onKeys])

  return (
    <NewSessionScreen
      cwd={props.cwd}
      model={props.model}
      choosingModel={props.choosingModel}
      composer={composer}
      attachments={attachments}
      prompt={prompt}
      width={props.width}
      height={props.height}
      notice={<NoticeStack width={props.width} />}
    />
  )
}
