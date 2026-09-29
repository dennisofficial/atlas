import React from 'react'

import { releaseNotesHeading, type ReleaseNotesRow } from '@dltech/atlas-core'

import { useClickRegion } from '../hooks/use-click-region'
import { MarkdownView } from '../markdown/markdown-view'
import { theme } from '../theme'

export type WhatsNewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly ReleaseNotesRow[] }
  | { readonly kind: 'failed' }

function CloseButton(props: { onClose: () => void }): React.ReactNode {
  const region = useClickRegion(props.onClose)
  return (
    <box {...region.handlers} {...(region.wash.bg === undefined ? {} : { backgroundColor: region.wash.bg })}>
      <text fg={region.hovered ? theme.bright : theme.meta}>{' ✕ '}</text>
    </box>
  )
}

function VersionSection(props: { row: ReleaseNotesRow; width: number }): React.ReactNode {
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.accent}>{`v${props.row.version}`}</text>
      {props.row.body.length === 0 ? (
        <text fg={theme.hint}>no notes published for this release</text>
      ) : (
        <MarkdownView source={props.row.body} width={props.width} fg={theme.body} />
      )}
      <box height={1} />
    </box>
  )
}

export function WhatsNew(props: {
  width: number
  height: number
  fromVersion: string | null
  currentVersion: string
  releasesUrl: string
  state: WhatsNewState
  onClose: () => void
}): React.ReactNode {
  const modalWidth = Math.min(72, Math.max(40, props.width - 8))
  const modalHeight = Math.min(30, Math.max(10, props.height - 6))
  const contentWidth = modalWidth - 6

  const heading = releaseNotesHeading({ from: props.fromVersion, to: props.currentVersion })

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      alignItems="center"
      justifyContent="center"
      zIndex={50}
    >
      <box
        flexDirection="column"
        width={modalWidth}
        height={modalHeight}
        border
        borderStyle="rounded"
        borderColor={theme.accent}
        backgroundColor={theme.overlayBg}
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row" justifyContent="space-between" flexShrink={0} paddingTop={1}>
          <text fg={theme.bright}>{heading}</text>
          <CloseButton onClose={props.onClose} />
        </box>
        <box height={1} flexShrink={0} />

        {props.state.kind === 'loading' ? (
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.hint}>fetching release notes…</text>
          </box>
        ) : props.state.kind === 'failed' ? (
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.warn}>{`couldn't fetch the notes — ${props.releasesUrl}`}</text>
          </box>
        ) : props.state.rows.length === 0 ? (
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.hint}>no published notes in this range</text>
          </box>
        ) : (
          <scrollbox flexGrow={1} focused>
            {props.state.rows.map((row) => (
              <VersionSection key={row.version} row={row} width={contentWidth} />
            ))}
          </scrollbox>
        )}

        <box flexShrink={0} paddingBottom={1}>
          <text fg={theme.meta}>{'↑↓ scroll · esc close'}</text>
        </box>
      </box>
    </box>
  )
}
