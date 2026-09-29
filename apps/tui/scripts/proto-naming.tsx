#!/usr/bin/env bun
/**
 * PROTOTYPE (throwaway): the session-naming animation as a lifecycle.
 *
 * Paints the two real surfaces that carry a session title — the sidebar head line
 * (bright text on the app ground) and the composer head slab (dark text on the
 * accent slab) — through the three states the real feature has:
 *
 *   settled     — the title, static
 *   generating  — the titler request is in flight; the line is noise dots
 *   streaming   — the answer arrived; dots settle left→right into the title
 *
 * bun apps/tui/scripts/proto-naming.tsx
 *   space — advance the lifecycle (settled → generating → streaming → settled)
 *   1/2/3/4 — streaming settle speed: 900 / 600 / 400 / 250 ms
 *   s — slow motion · q — quit
 *
 * The question: how fast should the settle read, and does the noise hold the wait?
 */
import { createCliRenderer, RGBA, StyledText, type TextChunk, type TextRenderable } from '@opentui/core'
import { createRoot, useKeyboard, useRenderer } from '@opentui/react'
import React, { useEffect, useRef, useState } from 'react'

import { subscribeTicker } from '../src/ui/hooks/use-shimmer-clock'
import { mixHex } from '../src/ui/colour'
import { SHIMMER_TICK_MS } from '../src/ui/shimmer-frames'
import { theme } from '../src/ui/theme'

const SIDEBAR_CELLS = 40
const COMPOSER_CELLS = 34

const rgbaCache = new Map<string, RGBA>()

const rgbaOf = (hex: string): RGBA => {
  const held = rgbaCache.get(hex)
  if (held !== undefined) return held
  const next = RGBA.fromHex(hex)
  rgbaCache.set(hex, next)
  return next
}

const chunk = (text: string, fg: string): TextChunk => ({ __isChunk: true, text, fg: rgbaOf(fg) })

// ---------------------------------------------------------------------------

// the incoming answer is longer than one surface and shorter than the other,
// so both directions of the length glide are on screen.
const TITLE = 'fix the sidebar shimmer crest on rename'

const NOISE = '····:∙' // all dots — the "random dots" reading

const randomOf = (pool: string): string => pool[Math.floor(Math.random() * pool.length)] ?? '·'

const SETTLES = [900, 600, 400, 250] as const

enum EPhase {
  Settled = 'settled',
  Generating = 'generating',
  Streaming = 'streaming',
}

type Surfaces = { sidebar: StyledText; composer: StyledText }

const padChunks = (chunks: TextChunk[], length: number, fg: string): TextChunk[] => {
  const used = chunks.reduce((sum, c) => sum + [...c.text].length, 0)
  if (used >= length) return chunks
  return [...chunks, chunk(' '.repeat(length - used), fg)]
}

// generating — the request is in flight: a line of reshuffling dots, dimmed under
// the settled tone. It never settles; the answer arriving is what ends it.
const paintGenerating = (): Surfaces => ({
  sidebar: new StyledText(
    Array.from({ length: SIDEBAR_CELLS }, () => chunk(randomOf(NOISE), mixHex({ from: theme.bright, to: theme.appBg, amount: 0.45 }))),
  ),
  composer: new StyledText(
    Array.from({ length: COMPOSER_CELLS }, () => chunk(randomOf(NOISE), mixHex({ from: theme.caretFg, to: theme.accent, amount: 0.35 }))),
  ),
})

// streaming — the answer is in: letters resolve left→right into the real title
// while the whole line glides from the generating width to the final width, so a
// shorter answer shrinks the line smoothly instead of snapping shorter at the end.
// `startCells` is the width the generating phase ended at.
const paintStreaming = (now: number, startedAt: number, settleMs: number, startCells: { sidebar: number; composer: number }): Surfaces => {
  const progress = Math.min(1, (now - startedAt) / settleMs)
  const settledCount = Math.floor(progress * TITLE.length)

  const surface = (start: number, settledFg: string, noiseFg: string): StyledText => {
    const cells = Math.round(start + (TITLE.length - start) * progress)
    const chunks: TextChunk[] = []
    for (let index = 0; index < cells; index++) {
      if (index < settledCount) chunks.push(chunk(TITLE[index] ?? ' ', settledFg))
      else chunks.push(chunk(randomOf(NOISE), noiseFg))
    }
    return new StyledText(chunks)
  }

  return {
    sidebar: surface(startCells.sidebar, theme.bright, mixHex({ from: theme.bright, to: theme.appBg, amount: 0.55 })),
    composer: surface(startCells.composer, theme.caretFg, mixHex({ from: theme.caretFg, to: theme.accent, amount: 0.45 })),
  }
}

// settled — nothing happening. The composer slab keeps its pad cells; the title
// past its row is simply not drawn, same as the real truncation.
const paintSettled = (): Surfaces => ({
  sidebar: new StyledText([chunk(TITLE, theme.bright)]),
  composer: new StyledText([chunk(` ${TITLE.slice(0, COMPOSER_CELLS)} `, theme.caretFg)]),
})

// ---------------------------------------------------------------------------
// a ticking line: writes the painted StyledText straight into the renderable,
// like ShimmerLine does — no React commit per frame.

function TickLine(props: { paint: (now: number) => StyledText; bg?: string | undefined; slow: boolean }): React.ReactNode {
  const ref = useRef<TextRenderable>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const paint = (now: number): void => {
      const node = ref.current
      if (node === null || node.isDestroyed) return
      node.content = latest.current.paint(latest.current.slow ? now / 3 : now)
    }
    paint(Date.now())
    return subscribeTicker({ intervalMs: SHIMMER_TICK_MS, onTick: paint })
  }, [])

  return <text ref={ref} content={props.paint(Date.now())} {...(props.bg === undefined ? {} : { bg: props.bg })} />
}

// ---------------------------------------------------------------------------

function ProbeApp(): React.ReactNode {
  const renderer = useRenderer()
  const [phase, setPhase] = useState<EPhase>(EPhase.Settled)
  const [settle, setSettle] = useState(2)
  const [slow, setSlow] = useState(false)
  const streamStart = useRef(0)

  useKeyboard((key) => {
    if (key.name === 'space') {
      if (phase === EPhase.Settled) setPhase(EPhase.Generating)
      else if (phase === EPhase.Generating) {
        streamStart.current = Date.now()
        setPhase(EPhase.Streaming)
      } else setPhase(EPhase.Settled)
    }
    if (key.name === 's') setSlow((s) => !s)
    if (key.name === '1') setSettle(0)
    if (key.name === '2') setSettle(1)
    if (key.name === '3') setSettle(2)
    if (key.name === '4') setSettle(3)
    if (key.name === 'q') {
      renderer.destroy()
      process.exit(0)
    }
  })

  const settleMs = SETTLES[settle] as number
  const paint = (now: number): Surfaces => {
    if (phase === EPhase.Generating) return paintGenerating()
    if (phase === EPhase.Streaming) {
      const painted = paintStreaming(now, streamStart.current, settleMs, { sidebar: SIDEBAR_CELLS, composer: COMPOSER_CELLS })
      if (now - streamStart.current >= settleMs) setPhase(EPhase.Settled)
      return painted
    }
    return paintSettled()
  }

  const label =
    phase === EPhase.Settled ? 'settled — space starts a rename' :
    phase === EPhase.Generating ? 'generating — the request is out; space = the answer arrives' :
    `streaming — settling over ${settleMs}ms`

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text fg={theme.hint}>sidebar head:</text>
      <TickLine key={`side-${phase}`} paint={(now) => paint(now).sidebar} slow={slow} />
      <text fg={theme.hint}>composer slab:</text>
      <box>
        <TickLine key={`comp-${phase}`} paint={(now) => paint(now).composer} bg={theme.accent} slow={slow} />
      </box>
      <text fg={theme.accent}>{`▸ ${label}${slow ? ' (slow motion)' : ''}`}</text>
      <text fg={theme.dim}>space advance lifecycle · 1/2/3/4 settle 900/600/400/250ms · s slow motion · q quit</text>
    </box>
  )
}

const renderer = await createCliRenderer({ exitOnCtrlC: true })
createRoot(renderer).render(<ProbeApp />)
