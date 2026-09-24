import type { Renderable, ScrollBoxRenderable } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { isPinnedToBottom } from '../scroll-position'

import {
  WINDOW_CAP,
  WINDOW_MARGIN,
  WINDOW_THRESHOLD,
  entryAtRow,
  estimateRows,
  initialSpan,
  mountSpans,
  rowsPerEntry,
  sectionsOf,
  topsOf,
  visibleSpan,
  windowSpan,
  type MountSection,
  type Span,
} from '../entry-window'

export type EntryWindow = {
  active: boolean
  sections: readonly MountSection[]
  handleTick: () => void
  offsetOfKey: (key: string) => number | null
  pinToKey: (args: { key: string; offset: number }) => void
}

type ScrollAnchor = { key: string; offset: number }

const sameSpans = (left: readonly Span[], right: readonly Span[]): boolean =>
  left.length === right.length &&
  left.every((span, index) => span.start === right[index]?.start && span.end === right[index]?.end)

/**
 * OpenTUI's native handle pools cap at 2^14 per kind (TextBuffer, SyntaxStyle, renderable), and a
 * mounted transcript entry costs a dozen or more. Past a few hundred entries a resume throws
 * `Failed to create TextBuffer` mid-render and the tree unmounts before any boundary can paint.
 * Windowing mounts only the entries near the viewport; the rest stand in as measured-height
 * spacers so the scroll extent survives. Entries an active mouse selection covers stay mounted
 * beside the window, because OpenTUI re-derives a selection's screen position from the renderable
 * it started on and unmounting that renderable freezes the highlight mid-scroll.
 */
export function useEntryWindow(args: {
  entries: readonly { key: string }[]
  scroller: RefObject<ScrollBoxRenderable | null>
  anchorIndex: number
  width: number
  onNearTop?: (() => void) | undefined
}): EntryWindow {
  const renderer = useRenderer()
  const active = args.entries.length > WINDOW_THRESHOLD
  const measured = useRef(new Map<string, number>())
  const measuredAtWidth = useRef(args.width)
  const [version, setVersion] = useState(0)
  const [spans, setSpans] = useState<readonly Span[]>(() =>
    args.entries.length > WINDOW_THRESHOLD
      ? [
          initialSpan({
            total: args.entries.length,
            anchorIndex: args.anchorIndex,
            margin: WINDOW_MARGIN,
            cap: WINDOW_CAP,
          }),
        ]
      : [{ start: 0, end: Number.MAX_SAFE_INTEGER }],
  )

  const live = useRef({ active, entries: args.entries })
  live.current = { active, entries: args.entries }

  const anchor = useRef<ScrollAnchor | null>(null)

  useEffect(() => {
    if (!live.current.active) return
    setSpans([
      initialSpan({
        total: args.entries.length,
        anchorIndex: args.anchorIndex,
        margin: WINDOW_MARGIN,
        cap: WINDOW_CAP,
      }),
    ])
  }, [active])

  const indexOfKey = useMemo(
    () => new Map(args.entries.map((entry, index) => [entry.key, index])),
    [args.entries],
  )
  const indexOfKeyLive = useRef(indexOfKey)
  indexOfKeyLive.current = indexOfKey

  const layout = useMemo(() => {
    const rows = rowsPerEntry({
      keys: args.entries.map((entry) => entry.key),
      measured: measured.current,
      estimate: estimateRows({ measured: measured.current }),
    })
    return { rows, tops: topsOf({ rows }) }
  }, [args.entries, version])
  const layoutLive = useRef(layout)
  layoutLive.current = layout

  /**
   * The layout the model will render next, recomputed from the measurement map rather than read
   * from render-side state: a later render can overwrite the live layout ref before an earlier
   * commit's effect runs, and native positions (child.y, scrollHeight) are stale until a frame
   * paints. The map is written only here, so a layout derived from it inside the effect is
   * exactly what the user sees before the bump and exactly what the next commit paints after it.
   */
  const layoutFromMeasured = (): { rows: number[]; tops: number[] } => {
    const rows = rowsPerEntry({
      keys: live.current.entries.map((entry) => entry.key),
      measured: measured.current,
      estimate: estimateRows({ measured: measured.current }),
    })
    return { rows, tops: topsOf({ rows }) }
  }

  useEffect(() => {
    if (measuredAtWidth.current === args.width) return
    measuredAtWidth.current = args.width
    const box = args.scroller.current
    if (box !== null && anchor.current === null) {
      const { tops, rows } = layoutFromMeasured()
      const index = entryAtRow({ tops, rows, row: box.scrollTop })
      const key = index === null ? undefined : live.current.entries[index]?.key
      if (index !== null && key !== undefined) {
        anchor.current = { key, offset: box.scrollTop - (tops[index] ?? 0) }
      }
    }
    measured.current.clear()
    setVersion((v) => v + 1)
  }, [args.width, args.scroller])

  useEffect(() => {
    if (!active) return
    const box = args.scroller.current
    if (!box) return

    const painted = layoutFromMeasured()

    let changed = false
    let unlaid = false
    for (const child of box.content.getChildren()) {
      if (!indexOfKeyLive.current.has(child.id)) continue
      if (child.height === 0) {
        unlaid = true
        continue
      }
      if (measured.current.get(child.id) === child.height) continue
      measured.current.set(child.id, child.height)
      changed = true
    }

    if (changed && anchor.current === null) {
      const tailing = isPinnedToBottom({
        scrollTop: box.scrollTop,
        scrollHeight: box.scrollHeight,
        viewportHeight: box.viewport.height,
      })
      if (!tailing) {
        const index = entryAtRow({ tops: painted.tops, rows: painted.rows, row: box.scrollTop })
        const key = index === null ? undefined : live.current.entries[index]?.key
        if (index !== null && key !== undefined) {
          anchor.current = { key, offset: box.scrollTop - (painted.tops[index] ?? 0) }
        }
      }
    }

    const pending = anchor.current
    if (pending !== null) {
      const index = indexOfKeyLive.current.get(pending.key)
      if (index === undefined) {
        anchor.current = null
      } else {
        const target = Math.max(0, (layoutFromMeasured().tops[index] ?? 0) + pending.offset)
        if (box.scrollTop !== target) box.scrollTo(target)
        if (!changed && box.scrollTop === target) anchor.current = null
      }
    }

    if (changed) setVersion((v) => v + 1)
    if (unlaid) {
      const retry = setTimeout(() => setVersion((v) => v + 1), 0)
      return () => clearTimeout(retry)
    }
  })

  const selectionPin = useCallback((): Span | null => {
    const box = args.scroller.current
    const selection = renderer.getSelection()
    if (box === null || selection === null || !selection.isActive) return null

    const indices = indexOfKeyLive.current
    let start = Number.MAX_SAFE_INTEGER
    let end = -1
    const pin = (index: number | undefined | null): void => {
      if (index === undefined || index === null) return
      start = Math.min(start, index)
      end = Math.max(end, index + 1)
    }

    for (const touched of selection.touchedRenderables) {
      if (touched.isDestroyed) continue
      let node: Renderable | null = touched
      while (node !== null && !indices.has(node.id)) node = node.parent
      pin(node === null ? null : indices.get(node.id))
    }

    for (const point of [selection.anchor, selection.focus]) {
      const { tops, rows } = layoutLive.current
      pin(entryAtRow({ tops, rows, row: point.y - box.viewport.y + box.scrollTop }))
    }

    return end < 0 ? null : { start, end }
  }, [renderer, args.scroller])

  const onNearTop = useRef(args.onNearTop)
  onNearTop.current = args.onNearTop

  const handleTick = useCallback(() => {
    if (!live.current.active) return
    const box = args.scroller.current
    if (!box) return
    const { rows, tops } = layoutLive.current
    const visible = visibleSpan({
      tops,
      rows,
      scrollTop: box.scrollTop,
      viewportRows: box.viewport.height,
    })
    if (visible.start === 0) onNearTop.current?.()
    const base = windowSpan({ visible, total: rows.length, margin: WINDOW_MARGIN, cap: WINDOW_CAP })
    const next = mountSpans({ base, pinned: selectionPin(), total: rows.length })
    setSpans((prev) => (sameSpans(prev, next) ? prev : next))
  }, [args.scroller, selectionPin])

  const offsetOfKey = useCallback(
    (key: string): number | null => {
      const index = live.current.entries.findIndex((entry) => entry.key === key)
      if (index < 0) return null
      return layoutLive.current.tops[index] ?? null
    },
    [],
  )

  /**
   * Keep the given entry at the same offset from the viewport top across the layout change the
   * caller just committed — a prepended history page prices itself at the row estimate until its
   * entries mount and measure, so a one-shot scrollTo lands on the estimate's error. The anchor
   * re-pins by identity once the layout catches up, and every later measurement pass re-anchors
   * from the live scroll position, converging to the exact offset.
   */
  const pinToKey = useCallback((pin: { key: string; offset: number }): void => {
    anchor.current = { key: pin.key, offset: pin.offset }
  }, [])

  const sections = useMemo(
    (): readonly MountSection[] =>
      active
        ? sectionsOf({ tops: layout.tops, rows: layout.rows, spans })
        : [{ kind: 'entries', span: { start: 0, end: args.entries.length } }],
    [active, layout, spans, args.entries.length],
  )

  return { active, sections, handleTick, offsetOfKey, pinToKey }
}
