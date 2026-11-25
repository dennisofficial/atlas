'use dom'

import mermaid from 'mermaid'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import {
  DIAGRAM_HINT_INSET,
  DIAGRAM_MIN_SCALE,
  fitTransform,
  type IDiagramTransform,
  minScaleFor,
  zoomAbout,
} from './diagram-layout'
import { hintStyle, type IMermaidColors, THEME_CSS, varsOf } from './mermaid-theme'

const RESTING_TRANSFORM: IDiagramTransform = { scale: 1, x: 0, y: 0 }
const INTERACTIVE_HINT = 'Pinch to zoom, drag to pan, double-tap to fit'

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
    style?: { width?: number; height?: number; flex?: number; backgroundColor?: string }
  }
  onRendered?: (size: IMermaidSize) => Promise<void>
  onError?: (message: string) => Promise<void>
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : 'The diagram could not render.'

const naturalSizeOf = (node: SVGSVGElement): IMermaidSize => {
  const rect = node.getBoundingClientRect()
  const box = node.viewBox?.baseVal
  if (box === undefined || box.width <= 0 || box.height <= 0) {
    return { width: rect.width, height: rect.height }
  }
  return { width: box.width, height: box.height }
}

const placeSvg = ({ node, size }: { node: SVGSVGElement; size: IMermaidSize }): void => {
  node.removeAttribute('height')
  node.style.display = 'block'
  node.style.background = 'transparent'
  node.style.width = '100%'
  node.style.maxWidth = `${Math.ceil(size.width)}px`
  node.style.height = 'auto'
  node.style.margin = '0 auto'
}

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
  const content = useRef<IMermaidSize | undefined>(undefined)
  const minScale = useRef(DIAGRAM_MIN_SCALE)
  const [error, setError] = useState<string>()
  const [transform, setTransform] = useState<IDiagramTransform>(RESTING_TRANSFORM)
  const transformRef = useRef(transform)
  transformRef.current = transform
  const [touched, setTouched] = useState(false)
  const themeKey = `${colors.card}|${colors.border}|${colors.foreground}|${colors.mutedForeground}|${colors.nodeFill}|${colors.nodeStroke}|${font}`

  const fittedTransform = (): IDiagramTransform => {
    const box = viewport.current?.getBoundingClientRect()
    const size = content.current
    if (box === undefined || size === undefined) return RESTING_TRANSFORM
    return fitTransform({
      viewport: { width: box.width, height: box.height },
      content: size,
      inset: DIAGRAM_HINT_INSET,
      interactive,
    })
  }

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
        const size = naturalSizeOf(node)
        placeSvg({ node, size })
        content.current = size
        const next = fittedTransform()
        minScale.current = minScaleFor(next.scale)
        setError(undefined)
        setTransform(next)
        setTouched(false)
        await callbacks.current.onRendered?.({
          width: Math.round(size.width),
          height: Math.round(size.height),
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
  }, [source, font, themeKey, interactive])

  useEffect(() => {
    const node = viewport.current
    if (!interactive || node === null) return
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: number | undefined

    const centreOf = () => {
      const box = node.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }

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
      if (last === undefined || last === 0 || distance === 0) return
      const centre = centreOf()
      const focus = {
        x: (first.x + second.x) / 2 - centre.x,
        y: (first.y + second.y) / 2 - centre.y,
      }
      setTransform((current) =>
        zoomAbout({ transform: current, factor: distance / last, focus, min: minScale.current }),
      )
    }

    const handleUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinch = undefined
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const centre = centreOf()
      setTransform((current) =>
        zoomAbout({
          transform: current,
          factor: Math.exp(-event.deltaY / 300),
          focus: { x: event.clientX - centre.x, y: event.clientY - centre.y },
          min: minScale.current,
        }),
      )
    }

    const handleFit = () => {
      const next = fittedTransform()
      setTransform(next)
    }

    node.addEventListener('pointerdown', handleDown)
    node.addEventListener('pointermove', handleMove)
    node.addEventListener('pointerup', handleUp)
    node.addEventListener('pointercancel', handleUp)
    node.addEventListener('wheel', handleWheel, { passive: false })
    node.addEventListener('dblclick', handleFit)
    return () => {
      node.removeEventListener('pointerdown', handleDown)
      node.removeEventListener('pointermove', handleMove)
      node.removeEventListener('pointerup', handleUp)
      node.removeEventListener('pointercancel', handleUp)
      node.removeEventListener('wheel', handleWheel)
      node.removeEventListener('dblclick', handleFit)
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
    alignItems: 'center',
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
            width: '100%',
            transformOrigin: 'center center',
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
