import type { StreamSessionRow, SessionViewOutput } from '@dltech/atlas-protocol'
import { EPullRequestState } from '@dltech/atlas-core'

import type { Span } from '../ui/components/spans'
import { EFooterItemReach, type FooterItem } from '../ui/footer-item'
import { cellsOf } from '../ui/hint-layout'
import {
  ESidebarPlace,
  type SidebarRowAction,
  type SidebarRowSplit,
  type SidebarSection,
} from '../ui/sidebar-section'
import { spinnerFrame, theme } from '../ui/theme'

export type PullRequestChecks = {
  running: number
  passed: number
  failed: number
  expected?: number | undefined
}

export type PullRequestEntry = {
  repo: string
  number: number
  url: string
  branch: string
  state: string | null
  checks: PullRequestChecks | null
  current: boolean
}

type Linked = SessionViewOutput['pullRequests'][number]

const linkedEntryOf = (args: {
  entry: Linked
  primaryBranch: string | null
}): PullRequestEntry => ({
  repo: args.entry.repo,
  number: args.entry.number,
  url: args.entry.url,
  branch: args.entry.branch,
  state: args.entry.state?.state ?? null,
  checks: args.entry.state?.checks ?? null,
  current: args.primaryBranch !== null && args.entry.branch === args.primaryBranch,
})

export const pullRequestEntriesOf = (args: {
  row: StreamSessionRow | undefined
  linked: SessionViewOutput['pullRequests']
  branch: string | null
}): readonly PullRequestEntry[] => {
  const stub = args.row?.pullRequest ?? null
  if (stub === null) {
    return args.linked.map((entry) => linkedEntryOf({ entry, primaryBranch: args.branch }))
  }

  const matched = args.linked.find(
    (entry) => entry.number === stub.number && entry.repo === stub.repo,
  )
  const fromStub: PullRequestEntry = {
    repo: stub.repo,
    number: stub.number,
    url: stub.url,
    branch: matched?.branch ?? '',
    state: stub.state ?? matched?.state?.state ?? null,
    checks: matched?.state?.checks ?? stub.checks,
    current: args.branch !== null && matched?.branch === args.branch,
  }
  const others = args.linked
    .filter((entry) => entry !== matched)
    .map((entry) => linkedEntryOf({ entry, primaryBranch: args.branch }))
  return [fromStub, ...others]
}

export const pinnedEntryOf = (entries: readonly PullRequestEntry[]): PullRequestEntry | undefined =>
  entries.find((entry) => entry.current) ?? entries.at(-1)

const MUTED_INK = theme.body

export const statusInkOf = (entry: PullRequestEntry): string => {
  const checks = entry.checks
  if (checks !== null && checks.failed > 0) return theme.error
  if (checks !== null && checks.running > 0) return theme.warn
  if (checks !== null && checks.passed > 0) return theme.ok
  if (entry.state === EPullRequestState.Merged) return theme.court.external
  if (entry.state === EPullRequestState.Open) return theme.link
  return MUTED_INK
}

export const pullRequestChipOf = (
  entry: PullRequestEntry,
): { spans: readonly Span[]; ground: string } => {
  const ink = statusInkOf(entry)
  if (ink === MUTED_INK) {
    return { spans: [{ text: `#${entry.number}`, fg: MUTED_INK }], ground: theme.selectedBg }
  }
  return { spans: [{ text: `#${entry.number}`, fg: theme.appBg }], ground: ink }
}

export const pullRequestItemOf = (args: {
  entry: PullRequestEntry
  overflow: number
  onOpen: (url: string) => void
}): FooterItem => {
  const chip = pullRequestChipOf(args.entry)
  const [first] = chip.spans
  const spans =
    args.overflow === 0 || first === undefined
      ? chip.spans
      : [{ ...first, text: `${first.text} +${args.overflow}` }, ...chip.spans.slice(1)]

  return {
    id: 'pr',
    spans,
    ground: chip.ground,
    reach: EFooterItemReach.Keyboard,
    onActivate: () => args.onOpen(args.entry.url),
  }
}

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

export const pullRequestRowOf = (args: {
  entry: PullRequestEntry
  now: number
}): ((cells: number) => SidebarRowSplit) => {
  const { entry } = args
  const tally = entry.checks ?? { running: 0, passed: 0, failed: 0 }

  const number: Span[] = [{ text: `#${entry.number}`, fg: statusInkOf(entry) }]
  const titled: Span[] =
    entry.state === null ? number : [...number, { text: ` ${entry.state}`, fg: theme.meta }]
  const running: Span[] =
    tally.running === 0
      ? []
      : [{ text: `${spinnerFrame(args.now)} ${tally.running} running`, fg: theme.warn }]
  const passed: Span[] =
    tally.passed === 0 ? [] : [{ text: `${tally.passed} ${PASSED}`, fg: theme.ok }]
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

export const pullRequestSectionOf = (args: {
  entries: readonly PullRequestEntry[]
  branch: string | null
  now: number
  onOpen: (url: string) => void
  bellOf: (entry: PullRequestEntry) => SidebarRowAction | undefined
}): SidebarSection | null => {
  const rows = []
  if (args.branch !== null) {
    rows.push({
      id: 'branch',
      spans: { left: [{ text: args.branch, fg: theme.hover }], right: [] },
    })
  }
  for (const entry of args.entries) {
    const action = args.bellOf(entry)
    rows.push({
      id: `pull-request-${entry.number}`,
      spans: pullRequestRowOf({ entry, now: args.now }),
      onActivate: () => args.onOpen(entry.url),
      ...(action === undefined ? {} : { action }),
    })
  }
  if (rows.length === 0) return null

  return { id: 'github', place: ESidebarPlace.Facts, rows }
}
