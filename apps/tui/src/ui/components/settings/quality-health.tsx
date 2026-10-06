import {
  EQualityHealthStatus,
  type QualityHealth,
  type ThreadId,
} from '@dltech/atlas-core'
import React, { useMemo } from 'react'

import {
  EQualityHealthReadKind,
  type QualityHealthRead,
} from '../../../composition/use-quality-health'
import { theme } from '../../theme'
import { clipSpans, truncateCells, wrapCells } from '../sidebar/cells'
import { Spans, type Span } from '../spans'

const COVERAGE_NOTE =
  'covers direct write/edit tool calls on TypeScript and JavaScript files only — shell commands and outside tools are not reviewed'

const THREAD_LABEL_CELLS = 10

const OUTCOME_LABEL: Record<EQualityHealthStatus, string> = {
  [EQualityHealthStatus.NoReview]: 'no recorded review',
  [EQualityHealthStatus.CompletedNoFinding]: 'completed, no finding in the reviewed scope',
  [EQualityHealthStatus.Finding]: 'completed, finding in the reviewed scope',
  [EQualityHealthStatus.Skipped]: 'skipped',
  [EQualityHealthStatus.Inconclusive]: 'inconclusive',
  [EQualityHealthStatus.OperationalError]: 'operational error',
}

const healthColour = (status: EQualityHealthStatus): string => {
  if (status === EQualityHealthStatus.OperationalError) return theme.error
  if (status === EQualityHealthStatus.Finding) return theme.warn
  return theme.hint
}

const detailSpans = (args: { health: QualityHealth }): Span[] => {
  const spans: Span[] = [{ text: args.health.path ?? '' }]
  if (args.health.scope !== null) spans.push({ text: ` · ${args.health.scope.kind} ${args.health.scope.name}` })
  if (args.health.policyIds.length > 0) spans.push({ text: ` · ${args.health.policyIds.join(', ')}`, fg: theme.hint })
  if (args.health.recordedAt !== null) spans.push({ text: ` · ${args.health.recordedAt}`, fg: theme.hint })
  return spans
}

const outcomeSpans = (args: { read: QualityHealthRead }): Span[] => {
  if (args.read.kind === EQualityHealthReadKind.Loading) {
    return [{ text: 'reading…', fg: theme.hint }]
  }

  if (args.read.kind === EQualityHealthReadKind.Unavailable) {
    const lastKnown = args.read.lastKnown
    const spans: Span[] = [
      {
        text:
          lastKnown === null
            ? 'unavailable'
            : `${OUTCOME_LABEL[lastKnown.status]} · unavailable`,
        fg: theme.error,
      },
      { text: ` · refresh failed: ${args.read.reason}`, fg: theme.hint },
    ]
    if (lastKnown !== null && lastKnown.status !== EQualityHealthStatus.NoReview) {
      return [...spans, { text: ' — ' }, ...detailSpans({ health: lastKnown })]
    }
    return spans
  }

  const { health } = args.read
  const spans: Span[] = [{ text: OUTCOME_LABEL[health.status], fg: healthColour(health.status) }]
  if (health.reason !== undefined) spans.push({ text: ` (${health.reason})`, fg: theme.hint })
  if (health.status !== EQualityHealthStatus.NoReview) {
    return [...spans, { text: ' — ' }, ...detailSpans({ health })]
  }
  return spans
}

const headerText = (args: {
  enabled: boolean
  recording: boolean
  threadId: ThreadId
}): Span[] => [
  { text: 'last recorded review', fg: theme.meta },
  { text: ` · thread ${args.threadId.slice(0, THREAD_LABEL_CELLS)}`, fg: theme.hint },
  { text: ` — review ${args.enabled ? 'enabled' : 'disabled'}`, fg: theme.hint },
  { text: ` · recording ${args.recording ? 'on' : 'off'}`, fg: theme.hint },
]

export function QualityHealthStatus(props: {
  read: QualityHealthRead
  enabled: boolean
  recording: boolean
  threadId: ThreadId
  cells: number
}): React.ReactNode {
  const header = useMemo(
    () =>
      clipSpans({
        spans: headerText({
          enabled: props.enabled,
          recording: props.recording,
          threadId: props.threadId,
        }),
        cells: props.cells,
      }),
    [props.enabled, props.recording, props.threadId, props.cells],
  )
  const outcome = useMemo(
    () => clipSpans({ spans: outcomeSpans({ read: props.read }), cells: props.cells }),
    [props.read, props.cells],
  )
  const coverage = useMemo(
    () =>
      wrapCells({ text: COVERAGE_NOTE, cells: props.cells }).map((line) =>
        truncateCells({ text: line, cells: props.cells }),
      ),
    [props.cells],
  )

  return (
    <box flexDirection="column" flexShrink={0}>
      <text>
        <Spans spans={header} />
      </text>
      <text>
        <Spans spans={outcome} />
      </text>
      {coverage.map((line) => (
        <text key={line} fg={theme.hint}>
          {line}
        </text>
      ))}
    </box>
  )
}
