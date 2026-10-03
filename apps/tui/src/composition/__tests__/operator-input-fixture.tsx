import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner, type OperatorInputRequest, type RemoteDeltaChannel } from '@dltech/atlas-harness'
import { useKeyboard } from '@opentui/react'
import { testRender } from '@opentui/react/test-utils'
import React, { act, useState } from 'react'

import { OperatorInputOverlay } from '../../ui/components/operator-input'
import { useDraft } from '../../ui/hooks/use-draft'
import { useDraftTokens } from '../../ui/hooks/use-draft-tokens'
import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { fakeCloudChannel } from '../cloud/__tests__/fixture'
import { useComposerPaste } from '../use-composer-paste'
import { useOperatorInput, type OperatorInputControl } from '../use-operator-input'
import { useOverlayKeys } from '../use-overlay-keys'
import { fakeApp, scriptedModelPort } from './fake-app'

export const INPUT_THREAD = toThreadId('operator-input-thread')
export const INPUT_REQUEST = {
  requestId: 'input-request',
  description: 'Paste the complete document, including blank lines',
  url: 'https://example.com/authorize?code=readable',
  path: '/tmp/operator-input.txt',
}
export const SHIFT_ENTER_SEQUENCE = '\x1b[13;2u'
export const MULTILINE = '  leading\n\n' + '  line with tabs\tand Unicode 界\r\n'.repeat(400) + '\ntrailing  \n'

export async function mountInput(args: {
  remote?: RemoteDeltaChannel['request']
  cloud?: boolean
} = {}) {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }) })
  if (args.remote !== undefined) Object.assign(app.channel, { request: args.remote })
  const cloudRunner = args.cloud === true || args.remote !== undefined
    ? new RemoteTurnRunner({ channel: fakeCloudChannel(), wake: async () => {} })
    : null
  let held: OperatorInputControl | null = null
  let composer: ReturnType<typeof useDraft> | null = null
  let changeThread: ((threadId: ThreadId) => void) | null = null
  let interrupts = 0

  function Surface(): React.ReactNode {
    const [threadId, setThreadId] = useState(INPUT_THREAD)
    changeThread = setThreadId
    const control = useOperatorInput({
      app,
      threadId,
      cloudRunner,
      onInterrupt: () => { interrupts++ },
    })
    held = control
    const draft = useDraft('composer stays here')
    composer = draft
    const tokens = useDraftTokens({ editor: draft.editor, read: async () => null, directory: '/tmp' })
    useComposerPaste({ overlaid: control.state !== null, tokens, handleAttachImage: () => false })
    const handleKey = useOverlayKeys({
      veil: { shown: false, dismiss: () => {}, keys: [] },
      owners: [{ open: control.state !== null, handleKey: control.handleKey, porous: true }],
      bindings: () => [],
    })
    useKeyboard(handleKey)
    return (
      <box width="100%" height="100%">
        <textarea
          ref={draft.editor}
          initialValue={draft.initial}
          focused={control.state === null}
          height={3}
        />
        {control.state === null ? null : (
          <OperatorInputOverlay
            width={80}
            state={control.state}
            editor={control.editor}
            onChange={control.handleChange}
            onPaste={control.handlePaste}
            onSubmit={control.handleSubmit}
            onOpenUrl={control.handleOpenUrl}
          />
        )}
      </box>
    )
  }

  const setup = await testRender(<Surface />, { width: 80, height: 24 })
  const flush = async () => {
    await act(async () => {
      await settle(30)
      await setup.flush()
    })
  }
  const control = (): OperatorInputControl => {
    if (held === null) throw new Error('the operator input hook did not mount')
    return held
  }
  await flush()
  return {
    app,
    setup,
    input: {
      pasteBracketedText: async (text: string) => { await act(async () => { await setup.mockInput.pasteBracketedText(text) }) },
      typeText: async (text: string) => { await act(async () => { await setup.mockInput.typeText(text) }) },
      pressKey: (key: string, modifiers: { ctrl: boolean }) => { act(() => setup.mockInput.pressKey(key, modifiers)) },
      pressEnter: () => { act(() => setup.mockInput.pressEnter()) },
      pressShiftEnter: () => { act(() => setup.mockInput.pressKey(SHIFT_ENTER_SEQUENCE)) },
      pressEscape: () => { act(() => setup.mockInput.pressEscape()) },
      pressBackspace: () => { act(() => setup.mockInput.pressBackspace()) },
      pressArrow: (direction: 'left' | 'right') => { act(() => setup.mockInput.pressArrow(direction)) },
    },
    control,
    flush,
    interrupts: () => interrupts,
    composerText: () => composer?.editor.current?.plainText,
    switchThread: (threadId: ThreadId) => { act(() => { changeThread?.(threadId) }) },
    announce: (request: OperatorInputRequest = INPUT_REQUEST) => {
      act(() => app.channel.publisherFor({ threadId: INPUT_THREAD }).operatorInput({ open: request }))
    },
    clear: () => { act(() => app.channel.publisherFor({ threadId: INPUT_THREAD }).operatorInput({ open: null })) },
    done: async () => { await act(async () => { await teardown(setup) }) },
  }
}

export function deliveryGate<T>() {
  let resolve: ((value: T) => void) | null = null
  let reject: ((reason: Error) => void) | null = null
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason: Error) => reject?.(reason),
  }
}
