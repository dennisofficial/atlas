import type { KeyEvent } from '@opentui/core'

export type PaneOwner = {
  isOpen: () => boolean
  handleKey: (key: KeyEvent) => void
}

/**
 * An open pane owns the keyboard outright: every key reaches it, handled or not, so `esc` closes
 * the pane instead of also quitting or popping the screen behind it. The order of the owners is
 * the stacking order, topmost first.
 */
export const dispatchPaneKey = (args: { key: KeyEvent; owners: readonly PaneOwner[] }): boolean => {
  if (args.key.eventType === 'release') return false

  const owner = args.owners.find((one) => one.isOpen())
  if (owner === undefined) return false

  args.key.preventDefault()
  owner.handleKey(args.key)
  return true
}
