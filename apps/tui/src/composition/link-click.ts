import type { CliRenderer, MouseEvent } from '@opentui/core'
import { parseLineSuffix } from '@dltech/atlas-core'
import type { FileOpener, UrlOpener } from '@dltech/atlas-harness'

import { ENoticePosition, ENoticeTone, notify } from '../ui/notice-store'
import { glyph } from '../ui/theme'
import { ELinkVerdict, linkScopeAt, type LinkScope } from './link-scope'
import { resolvePathMention } from './path-links'

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
  let originScope: LinkScope | null = null
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
    originScope = linkScopeAt(event)
  }

  renderer.root.onMouseUp = (event) => {
    const start = origin
    const pressed = originUrl
    const pressedScope = originScope
    origin = null
    originUrl = null
    originScope = null
    if (event.button !== LEFT_BUTTON) return
    if (event.propagationStopped || event.defaultPrevented) return
    if (start === null) return
    if (!withinTravel({ from: start, event })) return

    const releasedScope = linkScopeAt(event)
    if (releasedScope !== pressedScope) return

    const pressedUrl = renderer.getLinkAt(event.x, event.y) ?? pressed
    if (pressedUrl === null) return

    event.stopPropagation()
    event.preventDefault()
    renderer.clearSelection()

    const verdict = releasedScope?.handle(pressedUrl) ?? { kind: ELinkVerdict.Pass }
    if (verdict.kind === ELinkVerdict.Handled) return
    const url = verdict.kind === ELinkVerdict.Open ? verdict.url : pressedUrl

    /**
     * A rendered link already resolved once, but a file can be deleted between paint and click,
     * and the resolver's cache is existence truth rather than freshness truth. Re-check here so a
     * dead target says so instead of claiming an open that opened nothing.
     */
    const target = linkTarget({ url })
    if (target === null) {
      notify({
        key: 'link-open',
        text: `${glyph.document} no such file: ${url.slice(FILE_SCHEME.length)}`,
        tone: ENoticeTone.Warn,
        position: ENoticePosition.Composer,
      })
      return
    }

    target.open({ openUrl, openFile })
    notify({ key: 'link-open', text: openedLabel(url), position: ENoticePosition.Composer })
  }
}

const FILE_SCHEME = 'file://'

function openedLabel(url: string): string {
  const mark = url.startsWith(FILE_SCHEME) ? glyph.document : glyph.external
  return `${mark} opened`
}

type LinkTarget = { open: (args: { openUrl: UrlOpener; openFile: FileOpener }) => void }

function linkTarget(args: { url: string }): LinkTarget | null {
  if (!args.url.startsWith(FILE_SCHEME)) {
    return { open: ({ openUrl }) => openUrl(args.url) }
  }

  const mention = parseLineSuffix(args.url.slice(FILE_SCHEME.length))
  const resolved = resolvePathMention(mention)
  if (resolved === null) return null

  return {
    open: ({ openFile }) =>
      openFile(
        resolved.line === undefined
          ? { path: resolved.path }
          : { path: resolved.path, line: resolved.line },
      ),
  }
}
