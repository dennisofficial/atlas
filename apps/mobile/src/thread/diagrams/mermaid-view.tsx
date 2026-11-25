'use dom'

import mermaid from 'mermaid'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

const THEME_CSS = `
.node rect, .node polygon, .node circle, .node ellipse, .node path, .cluster rect { fill: var(--card) !important; stroke: var(--border) !important; }
.nodeLabel, .nodeLabel p, .label, .label text, .edgeLabel, .edgeLabel p, text, text.actor > tspan, .noteText > tspan { fill: var(--foreground) !important; color: var(--foreground) !important; }
.edgeLabel, .edgeLabel p, .edgeLabel rect, .labelBkg { background-color: var(--card) !important; fill: var(--card) !important; }
rect.actor, rect.note, .labelBox { fill: var(--card) !important; stroke: var(--border) !important; }
.actor-line { stroke: var(--border) !important; }
.flowchart-link, .edgePath path, .messageLine0, .messageLine1 { stroke: var(--muted-foreground) !important; }
.arrowheadPath, marker path { fill: var(--muted-foreground) !important; stroke: var(--muted-foreground) !important; }
`

const MIN_SCALE = 0.4
const MAX_SCALE = 5
const INTERACTIVE_HINT = 'Pinch to zoom, drag to pan, double-tap to fit'

export interface IMermaidColors {
  card: string
  border: string
  foreground: string
  mutedForeground: string
}

export interface IMermaidSize {
  width: number
  height: number
}

export interface IMermaidViewProps {
  source: string
  colors: IMermaidColors
  font: string
  interactive: boolean
  dom?: {
    matchContents?: boolean
    scrollEnabled?: boolean
    style?: { flex?: number; backgroundColor?: string }
  }
  onRendered?: (size: IMermaidSize) => Promise<void>
  onError?: (message: string) => Promise<void>
}

const clampScale = (scale: number): number => Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)

const varsOf = ({ colors, font }: { colors: IMermaidColors; font: string }): CSSProperties =>
  ({
    '--card': colors.card,
    '--border': colors.border,
    '--foreground': colors.foreground,
    '--muted-foreground': colors.mutedForeground,
    '--font-sans': font,
  }) as CSSProperties

const hintStyle = (colors: IMermaidColors): CSSProperties => ({
  position: 'absolute',
  bottom: 24,
  margin: 0,
  color: colors.mutedForeground,
  fontFamily: 'inherit',
  fontSize: 12,
  textAlign: 'center',
  width: '100%',
})

const messageOf = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : 'The diagram could not render.'

export default function MermaidView({
  source,
  colors,
  font,
  interactive,
  onRendered,
  onError,
}: IMermaidViewProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onRendered, onError })
  callbacks.current = { onRendered, onError }
  const renderId = useRef(`mermaid-${Math.random().toString(36).slice(2)}`)
  const [error, setError] = useState<string>()
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const [touched, setTouched] = useState(false)
  const themeKey = `${colors.card}|${colors.border}|${colors.foreground}|${colors.mutedForeground}|${font}`

  useEffect(() => {
    document.body.style.margin = '0'
    document.body.style.background = 'transparent'
  }, [])

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          fontFamily: font,
          themeCSS: THEME_CSS,
        })
        const { svg } = await mermaid.render(renderId.current, source)
        const target = host.current
        if (cancelled || target === null) return
        target.innerHTML = svg
        const node = target.querySelector('svg')
        if (node === null) throw new Error('The diagram rendered empty.')
        node.removeAttribute('height')
        node.style.maxWidth = '100%'
        node.style.height = 'auto'
        node.style.background = 'transparent'
        setError(undefined)
        setTransform({ scale: 1, x: 0, y: 0 })
        const rect = node.getBoundingClientRect()
        await callbacks.current.onRendered?.({
          width: target.clientWidth,
          height: Math.round(rect.height),
        })
      } catch (cause) {
        if (cancelled) return
        const message = messageOf(cause)
        setError(message)
        await callbacks.current.onError?.(message)
      }
    }
    draw()
    return () => {
      cancelled = true
    }
  }, [source, font, themeKey])

  useEffect(() => {
    const node = viewport.current
    if (!interactive || node === null) return
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: number | undefined

    const handleDown = (event: PointerEvent) => {
      node.setPointerCapture?.(event.pointerId)
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      setTouched(true)
    }

    const handleMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId)
      if (previous === undefined) return
      const next = { x: event.clientX, y: event.clientY }
      pointers.set(event.pointerId, next)
      if (pointers.size === 1) {
        setTransform((current) => ({
          ...current,
          x: current.x + (next.x - previous.x),
          y: current.y + (next.y - previous.y),
        }))
        return
      }
      const [first, second] = [...pointers.values()]
      if (first === undefined || second === undefined) return
      const distance = Math.hypot(first.x - second.x, first.y - second.y)
      const last = pinch
      pinch = distance
      if (last === undefined || last === 0) return
      setTransform((current) => ({
        ...current,
        scale: clampScale(current.scale * (distance / last)),
      }))
    }

    const handleUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinch = undefined
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setTransform((current) => ({
        ...current,
        scale: clampScale(current.scale * Math.exp(-event.deltaY / 300)),
      }))
    }

    const handleReset = () => setTransform({ scale: 1, x: 0, y: 0 })

    node.addEventListener('pointerdown', handleDown)
    node.addEventListener('pointermove', handleMove)
    node.addEventListener('pointerup', handleUp)
    node.addEventListener('pointercancel', handleUp)
    node.addEventListener('wheel', handleWheel, { passive: false })
    node.addEventListener('dblclick', handleReset)
    return () => {
      node.removeEventListener('pointerdown', handleDown)
      node.removeEventListener('pointermove', handleMove)
      node.removeEventListener('pointerup', handleUp)
      node.removeEventListener('pointercancel', handleUp)
      node.removeEventListener('wheel', handleWheel)
      node.removeEventListener('dblclick', handleReset)
    }
  }, [interactive])

  const viewportStyle: CSSProperties = interactive
    ? {
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        background: colors.card,
      }
    : { width: '100%', overflow: 'hidden', pointerEvents: 'none', background: 'transparent' }

  const stageStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: interactive ? 'center' : 'flex-start',
    justifyContent: 'center',
    ...varsOf({ colors, font }),
  }

  return (
    <div ref={viewport} style={viewportStyle}>
      {error === undefined ? null : <p style={hintStyle(colors)}>{error}</p>}
      <div style={stageStyle}>
        <div
          ref={host}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: touched ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
      {interactive && !touched && error === undefined ? (
        <p style={hintStyle(colors)}>{INTERACTIVE_HINT}</p>
      ) : null}
    </div>
  )
}
