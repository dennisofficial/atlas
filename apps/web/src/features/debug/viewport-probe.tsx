'use client'

import Link from 'next/link'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { track } from '@/lib/analytics/analytics'

import { probeRowsOf, type TViewportSample } from './viewport-sample'

const UNIT_BARS = [
  { key: 'svh', height: '100svh', color: '#e5484d' },
  { key: 'lvh', height: '100lvh', color: '#30a46c' },
  { key: 'dvh', height: '100dvh', color: '#0090ff' },
  { key: 'vh', height: '100vh', color: '#f5d90a' },
  { key: 'fixed', height: undefined, color: '#ab4aba' },
] as const

const INSET_SIDES = ['top', 'right', 'bottom', 'left'] as const

const hiddenProbe: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
}

const heightOf = (element: HTMLElement | null) =>
  Math.round(element?.getBoundingClientRect().height ?? 0)

const paddingOf = ({ element, side }: { element: HTMLElement | null; side: string }) =>
  element === null
    ? 0
    : Math.round(Number.parseFloat(getComputedStyle(element).getPropertyValue(`padding-${side}`)))

export function ViewportProbe() {
  const bars = useRef<Record<string, HTMLDivElement | null>>({})
  const insets = useRef<HTMLDivElement | null>(null)
  const [sample, setSample] = useState<TViewportSample | null>(null)

  useEffect(() => {
    const handleMeasure = () => {
      const next: TViewportSample = {
        window: { width: window.innerWidth, height: window.innerHeight },
        documentHeight: document.documentElement.clientHeight,
        visualViewport:
          window.visualViewport === null
            ? null
            : {
                height: Math.round(window.visualViewport.height),
                offsetTop: Math.round(window.visualViewport.offsetTop),
              },
        screen: { width: window.screen.width, height: window.screen.height },
        units: {
          svh: heightOf(bars.current.svh ?? null),
          lvh: heightOf(bars.current.lvh ?? null),
          dvh: heightOf(bars.current.dvh ?? null),
          vh: heightOf(bars.current.vh ?? null),
          fixedInset: heightOf(bars.current.fixed ?? null),
        },
        insets: {
          top: paddingOf({ element: insets.current, side: 'top' }),
          right: paddingOf({ element: insets.current, side: 'right' }),
          bottom: paddingOf({ element: insets.current, side: 'bottom' }),
          left: paddingOf({ element: insets.current, side: 'left' }),
        },
        standalone: window.matchMedia('(display-mode: standalone)').matches,
      }
      setSample(next)
      track('viewport_probe', next)
    }
    const frame = requestAnimationFrame(handleMeasure)
    window.addEventListener('resize', handleMeasure)
    window.visualViewport?.addEventListener('resize', handleMeasure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleMeasure)
      window.visualViewport?.removeEventListener('resize', handleMeasure)
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black text-white">
      <div
        ref={insets}
        style={{
          ...hiddenProbe,
          ...Object.fromEntries(
            INSET_SIDES.map((side) => [
              `padding${side[0]?.toUpperCase()}${side.slice(1)}`,
              `env(safe-area-inset-${side}, 0px)`,
            ]),
          ),
        }}
      />
      {UNIT_BARS.map((bar, index) => (
        <div
          key={bar.key}
          ref={(element) => {
            bars.current[bar.key] = element
          }}
          className="absolute top-0 flex items-end justify-center pb-1 font-mono text-xs font-semibold text-black"
          style={{
            left: `${index * 20}%`,
            width: '20%',
            height: bar.height,
            bottom: bar.height === undefined ? 0 : undefined,
            background: bar.color,
            opacity: 0.85,
          }}
        >
          {bar.key}
        </div>
      ))}
      <div
        className="absolute inset-x-0 border-t-2 border-dashed border-white"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      />
      <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top,0px)+1rem)] rounded-lg bg-black/80 p-3 font-mono text-sm">
        {sample === null ? (
          <p>Measuring…</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {probeRowsOf(sample).map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-white/60">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <Link href="/threads" className="mt-3 inline-block underline">
          Back to Atlas
        </Link>
      </div>
    </div>
  )
}
