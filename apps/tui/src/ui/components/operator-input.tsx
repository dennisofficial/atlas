import type { PasteEvent, TextareaRenderable } from '@opentui/core'
import React, { type RefObject } from 'react'

import type { OperatorInputState } from '../../composition/use-operator-input'
import { fitHints, hintSpans, type Hint } from '../hint-layout'
import { COMPOSER_NEWLINE_BINDINGS } from '../composer-input-bindings'
import { useClickRegion, type ClickRegion } from '../hooks/use-click-region'
import { glyph, theme } from '../theme'
import { BottomDrawer, DRAWER_PAD, drawerCells, DrawerLine } from './drawer'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const OPERATOR_INPUT_HEADING = 'The agent needs you to paste something'

export function operatorInputHints(state: OperatorInputState): readonly Hint[] {
  if (state.kind === 'delivering') return [
    { key: '…', label: 'delivering' },
    { key: 'esc', label: 'interrupt the turn' },
  ]
  return [
    { key: '⏎', label: 'send — the model never sees it' },
    { key: 'shift+⏎', label: 'newline' },
    { key: 'esc', label: 'interrupt the turn' },
  ]
}

function Line(props: { spans: readonly Span[]; cells: number; region?: ClickRegion }): React.ReactNode {
  return (
    <DrawerLine
      {...(props.region === undefined
        ? {}
        : { press: props.region.handlers, hover: props.region.handlers, band: props.region.wash.bg })}
    >
      <text>
        <Spans spans={clipSpans({ spans: props.spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

export function OperatorInputOverlay(props: {
  width: number
  state: OperatorInputState
  editor: RefObject<TextareaRenderable | null>
  onChange: () => void
  onPaste: (event: PasteEvent) => void
  onSubmit: () => void
  onOpenUrl: () => void
}): React.ReactNode {
  const cells = drawerCells({ width: props.width })
  const send = useClickRegion(props.state.kind === 'awaiting' ? props.onSubmit : undefined)
  const url = useClickRegion(props.onOpenUrl)
  const { state } = props

  return (
    <BottomDrawer overlay>
      <Line spans={[{ text: OPERATOR_INPUT_HEADING, fg: theme.accent }]} cells={cells} />
      <box paddingLeft={DRAWER_PAD} paddingRight={DRAWER_PAD} flexShrink={0}>
        <text fg={theme.body}>{glyph.marker + ' ' + state.request.description}</text>
      </box>
      {state.request.url === undefined ? null : (
        <box
          id="operator-input-url"
          paddingLeft={DRAWER_PAD}
          paddingRight={DRAWER_PAD}
          flexShrink={0}
          backgroundColor={url.wash.bg ?? theme.overlayBg}
          {...url.handlers}
        >
          <text fg={theme.accent}>{state.request.url}</text>
        </box>
      )}
      <box paddingLeft={DRAWER_PAD} paddingRight={DRAWER_PAD} flexShrink={0}>
        <textarea
          key={state.request.requestId}
          id="operator-input-editor"
          ref={props.editor}
          initialValue={state.typed}
          focused={state.kind === 'awaiting'}
          height={5}
          width="100%"
          wrapMode="word"
          textColor={theme.bright}
          cursorColor={theme.accent}
          placeholder="Paste the value here. Enter sends; Shift+Enter adds a newline."
          placeholderColor={theme.hint}
          keyBindings={COMPOSER_NEWLINE_BINDINGS}
          onContentChange={props.onChange}
          onPaste={props.onPaste}
        />
      </box>
      {state.kind === 'awaiting' && state.failure !== null ? (
        <Line spans={[{ text: state.failure, fg: theme.warn }]} cells={cells} />
      ) : null}
      <box height={1} flexShrink={0} />
      <Line
        spans={hintSpans({
          hints: fitHints({ hints: operatorInputHints(state), cells }),
          keyColour: theme.meta,
        })}
        cells={cells}
        region={send}
      />
    </BottomDrawer>
  )
}
