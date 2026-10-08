import type { KeyEvent } from '@opentui/core'

import type { OverlayKeyOwner } from './use-overlay-keys'

export type OverlayPresence = {
  open: boolean
  handleKey?: ((key: KeyEvent) => void) | undefined
  porous?: boolean | undefined
  /**
   * Anything covering the composer must take focus with it: the terminal cursor is not part of the
   * character grid, so a focused textarea keeps drawing its caret straight through whatever is
   * painted over it.
   */
  coversComposer: boolean
  /**
   * Whether a picture has to be withheld while this is up. A kitty image cannot be layered over —
   * the terminal composites it above the text plane whatever z-order was asked for. Something that
   * narrows the transcript rather than painting across it leaves pictures alone.
   */
  coversTranscript: boolean
  /**
   * A blocking overlay with no input of its own (rotation, compaction) takes the composer's caret
   * even though it does not paint over it: the screen belongs to the overlay, so nothing may blink
   * or echo beneath it. Keystrokes still queue into the draft through the workspace input layer.
   * An overlay with a real input (operator input) must never set this — its own field holds focus.
   */
  blursComposer?: boolean | undefined
}

/** The usual drawer: owns the keyboard, and paints over both the composer and the transcript. */
export const covering = (open: boolean, handleKey: (key: KeyEvent) => void): OverlayPresence => ({
  open,
  handleKey,
  coversComposer: true,
  coversTranscript: true,
})

/** In order: one overlay owns the keyboard at a time, and the order here is the order they stack. */
export const keyOwners = (overlays: readonly OverlayPresence[]): readonly OverlayKeyOwner[] =>
  overlays.flatMap((overlay) => {
    const { handleKey } = overlay
    if (handleKey === undefined) return []

    return [
      {
        open: overlay.open,
        handleKey,
        ...(overlay.porous === undefined ? {} : { porous: overlay.porous }),
      },
    ]
  })

export const composerCovered = (overlays: readonly OverlayPresence[]): boolean =>
  overlays.some((overlay) => overlay.open && overlay.coversComposer)

export const transcriptCovered = (overlays: readonly OverlayPresence[]): boolean =>
  overlays.some((overlay) => overlay.open && overlay.coversTranscript)

/**
 * The composer is blurred when anything is painted over it or anything blurring is up — painting
 * alone is not the rule, since a bottom-drawer overlay leaves the composer visible but still owns
 * the screen.
 */
export const composerBlurred = (overlays: readonly OverlayPresence[]): boolean =>
  overlays.some(
    (overlay) => overlay.open && (overlay.coversComposer || overlay.blursComposer === true),
  )
