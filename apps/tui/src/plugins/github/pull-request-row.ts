import { pullRequestBadge, type PullRequest } from '@dltech/atlas-harness'

import type { Span } from '../../ui/components/spans'
import { cellsOf } from '../../ui/hint-layout'
import type { SidebarRowSplit } from '../../ui/sidebar-section'
import { spinnerFrame, theme } from '../../ui/theme'
import { pullRequestStatusColor } from './pull-request-pill'

const PASSED = '✓'

const FAILED = '✗'

const GROUP_SEPARATOR = '  '

const SIDE_GAP = 2

const joined = (groups: readonly Span[][]): readonly Span[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : [{ text: GROUP_SEPARATOR }, ...group]))

const widthOf = (spans: readonly Span[]): number =>
  spans.reduce((total, span) => total + cellsOf(span.text), 0)

const fits = (rung: SidebarRowSplit, cells: number): boolean => {
  const gap = rung.right.length === 0 ? 0 : SIDE_GAP
  return widthOf(rung.left) + gap + widthOf(rung.right) <= cells
}

/**
 * The number and state anchor the left edge and the check tally the right. Clipping still cuts the
 * tail when the column is too narrow for both, so a narrow column must be given a poorer composition
 * rather than a truncated rich one — the failing checks are the reading nobody can afford to miss.
 * The ladder drops the state, then the spinner, then the passing count, and never the number or the
 * failures.
 */
export function pullRequestRow(args: {
  pullRequest: PullRequest
  now: number
}): (cells: number) => SidebarRowSplit {
  const { pullRequest, now } = args
  const { tally } = pullRequest

  const number: Span[] = [
    { text: `#${pullRequest.number}`, fg: pullRequestStatusColor(pullRequestBadge(pullRequest)) },
  ]
  const titled: Span[] = [...number, { text: ` ${pullRequest.state}`, fg: theme.meta }]
  const running: Span[] =
    tally.running === 0
      ? []
      : [{ text: `${spinnerFrame(now)} ${tally.running} running`, fg: theme.warn }]
  const passed: Span[] = tally.passed === 0 ? [] : [{ text: `${tally.passed} ${PASSED}`, fg: theme.ok }]
  const failed: Span[] =
    tally.failed === 0 ? [] : [{ text: `${tally.failed} ${FAILED}`, fg: theme.error }]

  const ladder: readonly SidebarRowSplit[] = [
    { left: titled, right: joined([running, passed, failed]) },
    { left: number, right: joined([running, passed, failed]) },
    { left: number, right: joined([passed, failed]) },
    { left: number, right: failed },
    { left: number, right: [] },
  ]

  return (cells: number): SidebarRowSplit =>
    ladder.find((rung) => fits(rung, cells)) ?? { left: number, right: [] }
}
