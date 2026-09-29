import type { CliRenderer, MouseEvent } from '@opentui/core'
import type { FileOpener, UrlOpener } from '@dltech/atlas-harness'

import { ENoticeTone, notify } from '../ui/notice-store'

const LEFT_BUTTON = 0

/**
 * A clean click and a sloppy one land within a couple of cells of where they pressed; a copy-drag
 * travels across the text it highlights. A short movement budget is what separates them —
 * selection coverage cannot, because OpenTUI fills a wrapped text's whole span the moment a drag
 * crosses a row, so a drift onto an empty row still "selects" the link.
 */
const OPEN_TRAVEL_CELLS = 3

const withinTravel = (args: { from: { x: number; y: number }; event: MouseEvent }): boolean =>
  Math.max(Math.abs(args.from.x - args.event.x), Math.abs(args.from.y - args.event.y)) <=
  OPEN_TRAVEL_CELLS

const hoverListeners = new Set<() => void>()

let hoveredUrl: string | null = null

export const subscribeLinkHover = (listener: () => void): (() => void) => {
  hoverListeners.add(listener)
  return () => {
    hoverListeners.delete(listener)
  }
}

export const linkHoverUrl = (): string | null => hoveredUrl

export function notifyLinkHover(url: string | null): void {
  if (url === hoveredUrl) return
  hoveredUrl = url
  if (hoverListeners.size === 0) return
  for (const listener of hoverListeners) listener()
}

/**
 * OpenTUI packs a link id into every cell a link span covers and resolves it back with
 * getLinkAt, but ships no click-to-open of its own. The handler sits on the root renderable
 * because mouse events bubble child-to-parent: every link the app renders arrives here unless a
 * component on the path already claimed the click.
 *
 * The gesture is a press-and-release: the link opens when the press started or ended on it, even
 * if the pointer drifted between the two — so a sloppy click still opens. A drag that actually
 * highlights text is a copy, not an open, so link text stays selectable. Hovering a link washes
 * the cell and switches the pointer to a hand, the affordance AGENTS.md asks of anything
 * clickable.
 *
 * This is a designated raw-mouse owner alongside use-press.ts (see press-discipline.spec.ts):
 * usePress cannot express it, because its release handler fires only per-renderable — a
 * full-screen overlay renderable defeats OpenTUI's per-renderable link hit-test, since
 * getLinkAt reads the buffer of the renderable the hit test resolved to.
 */
export function installLinkClickOpen(args: {
  renderer: CliRenderer
  openUrl: UrlOpener
  openFile: FileOpener
}): void {
  const { renderer, openUrl, openFile } = args

  let origin: { x: number; y: number } | null = null
  let originUrl: string | null = null
  let pointerOnLink = false

  renderer.root.onMouseMove = (event) => {
    const url = renderer.getLinkAt(event.x, event.y)
    notifyLinkHover(url)
    const onLink = url !== null
    if (onLink === pointerOnLink) return
    pointerOnLink = onLink
    renderer.setMousePointer(onLink ? 'pointer' : 'default')
  }

  renderer.root.onMouseDown = (event) => {
    if (event.button !== LEFT_BUTTON) return
    if (event.propagationStopped || event.defaultPrevented) return
    origin = { x: event.x, y: event.y }
    originUrl = renderer.getLinkAt(event.x, event.y)
  }

  renderer.root.onMouseUp = (event) => {
    const start = origin
    const pressed = originUrl
    origin = null
    originUrl = null
    if (event.button !== LEFT_BUTTON) return
    if (event.propagationStopped || event.defaultPrevented) return
    if (start === null) return
    if (!withinTravel({ from: start, event })) return

    const url = renderer.getLinkAt(event.x, event.y) ?? pressed
    if (url === null) return

    event.stopPropagation()
    event.preventDefault()
    renderer.clearSelection()
    openLink({ url, openUrl, openFile })
    notify({ text: `Opening ${url}`, tone: ENoticeTone.Done })
  }
}

const FILE_SCHEME = 'file://'

function openLink(args: { url: string; openUrl: UrlOpener; openFile: FileOpener }): void {
  if (!args.url.startsWith(FILE_SCHEME)) {
    args.openUrl(args.url)
    return
  }
  const file = fileTarget(args.url.slice(FILE_SCHEME.length))
  args.openFile(file)
}

function fileTarget(raw: string): { path: string; line?: number } {
  const line = /:(\d+)$/.exec(raw)?.[1]
  if (line === undefined) return { path: raw }
  return { path: raw.slice(0, raw.length - line.length - 1), line: Number(line) }
}
