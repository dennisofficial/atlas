#!/usr/bin/env bun
/**
 * PROTOTYPE (throwaway): hover affordances for click-to-open links.
 *
 * Interactive:  bun run proto:links   (from the repo root — the root script invokes bun directly;
 *   bun run --filter / turbo pipe stdin, leaving it un-raw, and mouse reports echo as
 *   ^[[<35;…M garbage)
 *   left/right — switch variant · t — toggle open-target (browser/editor) · q — quit
 *   Move the mouse over links and path:line mentions; ctrl+click opens (simulated).
 *
 * Variants:
 *   A — hover wash: hovered link cell gets hoverBg + pointer cursor
 *   B — tooltip: a floating hint line under the cursor naming the target and gesture
 *   C — ctrl reveal: holding ctrl brightens every link and shows a hint bar
 *      (caveat: ctrl release never arrives without kitty keyboard events:true,
 *      which Atlas does not enable — the reveal sticks until another key)
 *
 * Question: which affordance makes "clickable" discoverable without adding chrome?
 */
import { createCliRenderer, TextAttributes, type CliRenderer, type MouseEvent } from '@opentui/core'
import { createRoot, useKeyboard, useRenderer } from '@opentui/react'
import React, { useState } from 'react'

import { theme } from '../src/ui/palette'

type Hovered = { url: string; x: number; y: number } | null

type Variant = 'A' | 'B' | 'C'

const VARIANTS: readonly Variant[] = ['A', 'B', 'C']

const VARIANT_NAMES: Record<Variant, string> = {
  A: 'hover wash',
  B: 'tooltip',
  C: 'ctrl reveal',
}

type LinkTarget = { url: string; kind: 'web' | 'file' }

const LINKS: readonly LinkTarget[] = [
  { url: 'https://github.com/dennisofficial/atlas/pull/844', kind: 'web' },
  { url: 'file:///Users/dennis/Developer/atlas/apps/tui/src/composition/link-click.ts:42', kind: 'file' },
]

const openLabel = (target: LinkTarget, editor: boolean): string =>
  target.kind === 'file' && editor
    ? `open in editor — ${target.url.replace('file://', '')}`
    : `open — ${target.url.replace('file://', '')}`

function ProseLine(props: { hoveredUrl: string | null; ctrlHeld: boolean }): React.ReactNode {
  const wash = (url: string): { bg?: string; fg?: string } => {
    if (props.hoveredUrl === url) return { bg: theme.hoverBg, fg: theme.bright }
    if (props.ctrlHeld) return { fg: theme.bright }
    return {}
  }

  return (
    <text>
      <span fg={theme.body}>The fix shipped in </span>
      <span
        fg={theme.link}
        attributes={TextAttributes.UNDERLINE}
        link={{ url: LINKS[0]!.url }}
        {...wash(LINKS[0]!.url)}
      >
        #844
      </span>
      <span fg={theme.hint}>{' github.com '}</span>
      <span fg={theme.body}>— the hook lives in </span>
      <span
        fg={theme.link}
        attributes={TextAttributes.UNDERLINE}
        link={{ url: LINKS[1]!.url }}
        {...wash(LINKS[1]!.url)}
      >
        link-click.ts:42
      </span>
      <span fg={theme.body}>, installed at boot.</span>
    </text>
  )
}

function App(): React.ReactNode {
  const renderer = useRenderer()
  const [variant, setVariant] = useState<Variant>('A')
  const [hovered, setHovered] = useState<Hovered>(null)
  const [editor, setEditor] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)

  useKeyboard((key) => {
    if (key.name === 'left') cycle(-1)
    if (key.name === 'right') cycle(1)
    if (key.name === 't') setEditor((current) => !current)
    if (key.name === 'q') process.exit(0)
    if (key.name === 'ctrl') setCtrlHeld(true)
  })

  const cycle = (delta: number): void => {
    setVariant((current) => {
      const at = VARIANTS.indexOf(current)
      return VARIANTS[(at + delta + VARIANTS.length) % VARIANTS.length]!
    })
  }

  renderer.root.onMouseMove = (event: MouseEvent) => {
    const url = renderer.getLinkAt(event.x, event.y)
    setHovered(url === null ? null : { url, x: event.x, y: event.y })
    renderer.setMousePointer(url === null ? 'default' : 'pointer')
  }

  renderer.root.onMouseDown = (event: MouseEvent) => {
    if (!event.modifiers.ctrl) return
    const url = renderer.getLinkAt(event.x, event.y)
    if (url !== null) setOpened(url)
  }

  const hoveredLink = LINKS.find((link) => link.url === hovered?.url) ?? null

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={1} paddingTop={1} flexDirection="column">
        <text fg={theme.dim}>variant {variant} — {VARIANT_NAMES[variant]} · open target: {editor ? 'editor' : 'browser'}</text>
        <text fg={theme.dim}>{' '}</text>
        <ProseLine hoveredUrl={variant === 'A' ? (hovered?.url ?? null) : null} ctrlHeld={variant === 'C' && ctrlHeld} />
        <text fg={theme.dim}>{' '}</text>
        <text fg={theme.body}>
          <span>Plain text with a raw url: </span>
          <span fg={theme.link} attributes={TextAttributes.UNDERLINE} link={{ url: LINKS[0]!.url }}>
            https://github.com/dennisofficial/atlas/pull/844
          </span>
        </text>
        {opened !== null && <text fg={theme.ok}>ctrl+clicked: {opened}</text>}
      </box>

      {variant === 'B' && hoveredLink !== null && hovered !== null && (
        <box position="absolute" top={hovered.y + 1} left={Math.max(0, hovered.x - 4)}>
          <text bg={theme.panelBg} fg={theme.hint}>
            {` ctrl+click — ${openLabel(hoveredLink, editor)} `}
          </text>
        </box>
      )}

      {variant === 'C' && (
        <box position="absolute" bottom={1} left={1}>
          <text fg={ctrlHeld ? theme.ok : theme.dim}>
            {ctrlHeld ? 'release ctrl — click a link to open' : 'hold ctrl to reveal links'}
          </text>
        </box>
      )}

      <box position="absolute" bottom={0} left={0} right={0} justifyContent="center">
        <text bg={theme.panelBg} fg={theme.dim}>
          {' ←/→ variant · t target · q quit '}
        </text>
      </box>
    </box>
  )
}

const renderer = await createCliRenderer({ useMouse: true, exitOnCtrlC: false })
const root = createRoot(renderer)
root.render(<App />)
