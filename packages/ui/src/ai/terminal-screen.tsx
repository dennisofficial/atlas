'use client'

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { cn } from '#lib/utils'
import { MONO_FONT_VARIABLE, terminalThemeOf } from './internal/terminal-theme'

export interface TerminalSize {
  cols: number
  rows: number
}

export interface TerminalScreenHandle {
  write: (data: string | Uint8Array) => void
  clear: () => void
  focus: () => void
}

export interface TerminalScreenProps {
  ref?: Ref<TerminalScreenHandle>
  label?: string
  readOnly?: boolean
  dimmed?: boolean
  scrollback?: number
  fontSize?: number
  onData?: (data: string) => void
  onResize?: (size: TerminalSize) => void
  onReady?: (size: TerminalSize) => void
  className?: string
}

const DEFAULT_SCROLLBACK = 5000
const DEFAULT_FONT_SIZE = 12

type WriteOp = { kind: 'write'; data: string | Uint8Array } | { kind: 'clear' }

function readVariable(variable: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable)
}

function sizeOf(terminal: Terminal): TerminalSize {
  return { cols: terminal.cols, rows: terminal.rows }
}

export function TerminalScreen({
  ref,
  label = 'Terminal',
  readOnly = false,
  dimmed = false,
  scrollback = DEFAULT_SCROLLBACK,
  fontSize = DEFAULT_FONT_SIZE,
  onData,
  onResize,
  onReady,
  className,
}: TerminalScreenProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const queueRef = useRef<WriteOp[]>([])
  const callbacksRef = useRef({ onData, onResize, onReady })
  const readOnlyRef = useRef(readOnly)

  callbacksRef.current = { onData, onResize, onReady }
  readOnlyRef.current = readOnly

  useImperativeHandle(ref, () => ({
    write: (data) => {
      const terminal = terminalRef.current
      if (terminal) terminal.write(data)
      else queueRef.current.push({ kind: 'write', data })
    },
    clear: () => {
      const terminal = terminalRef.current
      if (terminal) terminal.reset()
      else queueRef.current = [{ kind: 'clear' }]
    },
    focus: () => terminalRef.current?.focus(),
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    let disposed = false
    let cleanup = () => {}

    const mount = async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      if (disposed) return

      const terminal = new XTerm({
        scrollback,
        fontSize,
        fontFamily: readVariable(MONO_FONT_VARIABLE),
        theme: terminalThemeOf({ read: readVariable }),
        cursorBlink: true,
        allowProposedApi: false,
      })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(host)

      let lastSize: TerminalSize | undefined
      const emitSize = () => {
        const size = sizeOf(terminal)
        if (lastSize?.cols === size.cols && lastSize.rows === size.rows) return
        lastSize = size
        callbacksRef.current.onResize?.(size)
      }
      const refit = () => {
        if (host.clientWidth === 0 || host.clientHeight === 0) return
        fit.fit()
        emitSize()
      }

      const dataSubscription = terminal.onData((data) => {
        if (!readOnlyRef.current) callbacksRef.current.onData?.(data)
      })
      const observer = new ResizeObserver(refit)
      observer.observe(host)
      const themeObserver = new MutationObserver(() => {
        terminal.options.theme = terminalThemeOf({ read: readVariable })
      })
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme'],
      })

      terminalRef.current = terminal
      refit()
      for (const op of queueRef.current) {
        if (op.kind === 'clear') terminal.reset()
        else terminal.write(op.data)
      }
      queueRef.current = []
      callbacksRef.current.onReady?.(sizeOf(terminal))

      cleanup = () => {
        observer.disconnect()
        themeObserver.disconnect()
        dataSubscription.dispose()
        terminal.dispose()
        terminalRef.current = null
      }
    }

    void mount()

    return () => {
      disposed = true
      cleanup()
    }
  }, [scrollback, fontSize])

  return (
    <section
      aria-label={label}
      className={cn(
        'min-h-0 flex-1 overflow-hidden bg-background px-3 py-2',
        dimmed && 'opacity-60',
        className,
      )}
    >
      <div ref={hostRef} className="size-full" />
    </section>
  )
}
