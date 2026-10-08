import type { KeyEvent } from '@opentui/core'
import { useCallback } from 'react'

import { isPrintable } from '../ui/keys/printable'
import { pressHandled, type PlacedBinding } from '../ui/keys'

export type OverlayKeyOwner = {
  open: boolean
  handleKey: (key: KeyEvent) => void
  /** Whether an unhandled key should still fall through to the global bindings. */
  porous?: boolean
}

/**
 * The edit keys a composer's textarea acts on natively: arrows walk the caret, backspace and
 * delete erase, return inserts a newline. While an overlay owns the screen the composer's buffer
 * may still be written through the blocked-input echo, but those keys must not act unseen — a
 * backspace silently deleting the last queued character is data damage.
 */
const FOCUSED_TEXTAREA_EDIT_KEYS: ReadonlySet<string> = new Set([
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
])

/**
 * Whether a key would act on the composer while nothing may touch it. Printable characters are
 * never swallowed here — the blocked-input echo is what queues them into the draft — and the
 * session chords (ctrl+…) are not either: a blurred textarea reports them unhandled, so they
 * must reach the global bindings.
 */
export function swallowsFocusedTextareaKey(key: KeyEvent): boolean {
  if (key.eventType === 'release') return false
  if (key.ctrl === true || key.meta === true) return false
  if (isPrintable(key)) return false
  return FOCUSED_TEXTAREA_EDIT_KEYS.has(key.name)
}

/**
 * One overlay owns the keyboard at a time, and the order here is the order they stack. The veil is
 * not an owner: any key dismisses it, and only the keys that mean "dismiss" are swallowed rather
 * than also doing what they normally do.
 */
export function useOverlayKeys(args: {
  veil: { shown: boolean; dismiss: () => void; keys: readonly string[] }
  owners: readonly OverlayKeyOwner[]
  bindings: () => readonly PlacedBinding[]
  onBlockedPrintable?: ((key: KeyEvent) => void) | undefined
  /** Whether the composer's textarea still holds the native focus while blurred. */
  swallowFocusedTextareaKeys?: (() => boolean) | undefined
}): (key: KeyEvent) => void {
  const { veil, owners, bindings, onBlockedPrintable, swallowFocusedTextareaKeys } = args

  return useCallback(
    (key: KeyEvent) => {
      if (key.eventType === 'release') return

      if (veil.shown) {
        veil.dismiss()
        if (key.name === 'escape' || veil.keys.includes(key.sequence ?? '')) {
          key.preventDefault()
          return
        }
      }

      for (const owner of owners) {
        if (!owner.open) continue

        if (owner.porous !== true) key.preventDefault()
        owner.handleKey(key)
        return
      }

      if (swallowFocusedTextareaKeys?.() === true && swallowsFocusedTextareaKey(key)) {
        key.preventDefault()
        return
      }

      if (pressHandled({ press: key, bindings: bindings() })) key.preventDefault()

      /**
       * A key that reached the end unhandled lands on the composer, which is blurred when this
       * layer is active — that is how typed drafts queue behind a blocking overlay rather than
       * being lost. Nothing but a printable may pass, and a printable is swallowed only once it
       * was echoed, so the same key never lands twice.
       */
      if (onBlockedPrintable === undefined) return
      if (key.defaultPrevented || !isPrintable(key)) return
      onBlockedPrintable(key)
      key.preventDefault()
    },
    [bindings, owners, veil, onBlockedPrintable, swallowFocusedTextareaKeys],
  )
}
