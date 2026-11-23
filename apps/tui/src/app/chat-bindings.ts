import type { KeyEvent } from '@opentui/core'

import { EKeyGroup, EKeyLayer, type KeyBinding } from '../ui/keys'

export type ChatHandlers = {
  draftIsEmpty: () => boolean
  onSubmit: () => void
  onTakeBackPending: () => boolean
  onAttachImage: () => void
  onEscape: () => void
}

const chat = (binding: Omit<KeyBinding, 'layer'>): KeyBinding => ({
  ...binding,
  layer: EKeyLayer.Global,
})

export const chatBindings = (handlers: ChatHandlers): readonly KeyBinding[] => [
  chat({
    chord: 'return',
    hint: 'send',
    describe: 'send the draft — or steer the turn while it runs',
    group: EKeyGroup.Composer,
    run: handlers.onSubmit,
  }),
  chat({
    chord: 'up',
    hint: 'take back',
    describe: 'take the last queued message back into the draft',
    group: EKeyGroup.Composer,
    run: () => handlers.draftIsEmpty() && handlers.onTakeBackPending(),
  }),
  chat({
    chord: 'ctrl+v',
    hint: 'paste image',
    describe: 'write the picture on the clipboard into the draft — ⌘V pastes only text',
    group: EKeyGroup.Composer,
    run: () => {
      handlers.onAttachImage()
      return true
    },
  }),
  chat({
    chord: 'escape',
    hint: 'stop',
    describe: 'stop the turn while it runs, or go back to the list',
    group: EKeyGroup.Turn,
    run: handlers.onEscape,
  }),
]

export const chatPressHandled = (args: {
  press: KeyEvent
  bindings: readonly KeyBinding[]
  match: (args: { chord: string; press: KeyEvent }) => boolean
}): boolean => {
  for (const binding of args.bindings) {
    if (!args.match({ chord: binding.chord, press: args.press })) continue
    if (binding.run() !== false) return true
  }
  return false
}
