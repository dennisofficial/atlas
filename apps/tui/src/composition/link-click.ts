import type { CliRenderer, MouseEvent } from '@opentui/core'
import type { UrlOpener } from '@dltech/atlas-harness'

import { ENoticeTone, notify } from '../ui/notice-store'

const LEFT_BUTTON = 0

const isPlainClick = (args: { event: MouseEvent; origin: { x: number; y: number } | null }): boolean =>
  args.origin !== null && args.origin.x === args.event.x && args.origin.y === args.event.y

/**
 * OpenTUI packs a link id into every cell a link span covers and resolves it back with
 * getLinkAt, but ships no click-to-open of its own. The handler sits on the root renderable
 * because mouse events bubble child-to-parent: every link the app renders arrives here unless a
 * component on the path already claimed the click.
 *
 * The gesture is ctrl+click, or plain click over a cell that cannot start a text selection.
 * Those are the clicks the renderer's own dispatch proves no selection anchor was taken for —
 * plain-clicking a selectable cell means drag-to-select, which must keep winning. Cmd never
 * arrives: the SGR mouse protocol encodes only shift/alt/ctrl.
 *
 * This is a designated raw-mouse owner alongside use-press.ts (see press-discipline.spec.ts):
 * usePress cannot express it, because its release handler fires only per-renderable — a
 * full-screen overlay renderable defeats OpenTUI's per-renderable link hit-test, since
 * getLinkAt reads the buffer of the renderable the hit test resolved to.
 */
export function installLinkClickOpen(args: { renderer: CliRenderer; openUrl: UrlOpener }): void {
  const { renderer, openUrl } = args

  let origin: { x: number; y: number } | null = null

  renderer.root.onMouseDown = (event) => {
    if (event.button !== LEFT_BUTTON) return
    if (event.propagationStopped || event.defaultPrevented) return
    origin = { x: event.x, y: event.y }
  }

  renderer.root.onMouseUp = (event) => {
    const start = origin
    origin = null
    if (event.button !== LEFT_BUTTON) return
    if (event.propagationStopped || event.defaultPrevented) return
    if (!isPlainClick({ event, origin: start })) return

    const url = renderer.getLinkAt(event.x, event.y)
    if (url === null) return
    if (!event.modifiers.ctrl && event.target?.selectable) return

    event.stopPropagation()
    event.preventDefault()
    renderer.clearSelection()
    openUrl(url)
    notify({ text: `Opening ${url}`, tone: ENoticeTone.Done })
  }
}
