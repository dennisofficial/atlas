import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react'
import { readFileSync } from 'node:fs'
import React, { useMemo, useRef, useState } from 'react'

import { annotateCrashStack } from '../../composition/crash-report'
import { copyToClipboard } from '../clipboard'
import { glyph, theme } from '../theme'
import { Spans, type Span } from './spans'

const HEADING = 'something broke'

const EXPLANATION = 'The interface hit an error it could not recover from.'

const KEEP = 'The session is stored on disk — quitting and reopening picks it back up.'

const SIDE_AIR = 6

const MAX_STACK_CELLS = 100

const STACK_SCREEN_SHARE = 0.45

const MIN_STACK_ROWS = 5

const EXIT_BACKSTOP_MS = 3000

const readSource = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

type CopyState = 'idle' | 'copied' | 'blocked'

function hintSpans(copy: CopyState): Span[] {
  const copyLabel =
    copy === 'copied' ? 'copied' : copy === 'blocked' ? 'copy blocked' : 'copy error'
  const copyFg = copy === 'copied' ? theme.ok : copy === 'blocked' ? theme.warn : theme.hover

  return [
    { text: glyph.copy, fg: copyFg },
    { text: ` c ${copyLabel}`, fg: copyFg },
    { text: '   ·   ', fg: theme.rule },
    { text: 'q quit', fg: theme.hover },
  ]
}

export function CrashScreen(props: {
  error: Error
  identity?: (() => string) | undefined
}): React.ReactNode {
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const [copy, setCopy] = useState<CopyState>('idle')
  const exiting = useRef(false)

  const cells = Math.max(20, Math.min(width - SIDE_AIR, MAX_STACK_CELLS))

  const report = useMemo(() => {
    const stack = props.error.stack ?? `${props.error.name}: ${props.error.message}`
    return annotateCrashStack({ stack, read: readSource, cells: cells - 2 })
  }, [props.error, cells])

  const who = props.identity?.() ?? null

  const handleCopy = (): void => {
    setCopy(copyToClipboard({ renderer, text: report }) ? 'copied' : 'blocked')
  }

  const handleExit = (): void => {
    if (exiting.current) return
    exiting.current = true
    renderer.destroy()
    setTimeout(() => process.exit(1), EXIT_BACKSTOP_MS).unref()
  }

  useKeyboard((key) => {
    if (key.name === 'c' && !key.ctrl) {
      handleCopy()
      return
    }
    if (key.name === 'q' || key.name === 'escape' || key.name === 'return') handleExit()
    if (key.ctrl && key.name === 'c') handleExit()
  })

  const rows = Math.max(MIN_STACK_ROWS, Math.floor(height * STACK_SCREEN_SHARE))

  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.appBg}
    >
      <box height={1} flexShrink={0}>
        <text fg={theme.warn}>{HEADING}</text>
      </box>
      <box height={1} flexShrink={0}>
        <text fg={theme.hint}>{EXPLANATION}</text>
      </box>
      <box height={1} flexShrink={0}>
        <text fg={theme.hint}>{KEEP}</text>
      </box>
      <box height={1} flexShrink={0} />
      {who === null ? null : (
        <box height={1} flexShrink={0}>
          <text fg={theme.hover}>{who}</text>
        </box>
      )}
      <box height={1} flexShrink={0} />
      <box
        width={cells}
        height={rows + 2}
        flexShrink={0}
        border
        borderColor={theme.rule}
        flexDirection="column"
      >
        <scrollbox scrollY height={rows} width={cells - 2}>
          <text fg={theme.body}>{report}</text>
        </scrollbox>
      </box>
      <box height={1} flexShrink={0} />
      <box height={1} flexShrink={0}>
        <text>
          <Spans spans={hintSpans(copy)} />
        </text>
      </box>
    </box>
  )
}
