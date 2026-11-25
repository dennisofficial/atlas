import type { KeyEvent } from '@opentui/core'
import { describe, expect, test } from 'bun:test'

import { chordMatches } from '../../ui/keys'
import { chatBindings, chatPressHandled, type ChatHandlers } from '../chat-bindings'

type Press = KeyEvent & { prevented: boolean }

const press = (args: { name: string; shift?: boolean }): Press => {
  let prevented = false
  return {
    name: args.name,
    eventType: 'press',
    shift: args.shift ?? false,
    ctrl: false,
    meta: false,
    preventDefault: () => {
      prevented = true
    },
    get prevented() {
      return prevented
    },
  } as unknown as Press
}

const handed = (args: {
  key: Press
  handlers?: Partial<ChatHandlers>
}): { handled: boolean; key: Press } => {
  const handlers: ChatHandlers = {
    draftIsEmpty: () => true,
    onSubmit: () => undefined,
    onTakeBackPending: () => false,
    onAttachImage: () => undefined,
    onEscape: () => undefined,
    ...args.handlers,
  }
  return {
    handled: chatPressHandled({
      press: args.key,
      bindings: chatBindings(handlers),
      match: chordMatches,
    }),
    key: args.key,
  }
}

describe('chatPressHandled', () => {
  test('the Enter that sends is prevented, so the editor does not also take it', () => {
    const key = press({ name: 'return' })
    const { handled } = handed({ key })

    expect(handled).toBe(true)
    expect(key.prevented).toBe(true)
  })

  test('shift+return is left to the editor for a newline', () => {
    const key = press({ name: 'return', shift: true })
    const { handled } = handed({ key })

    expect(handled).toBe(false)
    expect(key.prevented).toBe(false)
  })

  test('a binding that declines leaves the key alone', () => {
    const key = press({ name: 'up' })
    const { handled } = handed({ key, handlers: { draftIsEmpty: () => false } })

    expect(handled).toBe(false)
    expect(key.prevented).toBe(false)
  })
})
