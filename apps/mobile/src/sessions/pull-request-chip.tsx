import {
  EChecksSummary,
  EPullRequestGlyph,
  EPullRequestTone,
  isChecksTally,
  pullRequestDisplayOf,
  type PullRequestChecksTally,
  type PullRequestDisplay,
} from '@dltech/atlas-plugin-github/core'
import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import {
  Check,
  Clock,
  FastForward,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
  X,
} from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import type { SessionPullRequest } from './session-groups'
import { Spinning } from './status-icon'

const GLYPH_ICON: Record<EPullRequestGlyph, LucideIcon> = {
  [EPullRequestGlyph.Open]: GitPullRequest,
  [EPullRequestGlyph.Draft]: GitPullRequestDraft,
  [EPullRequestGlyph.Merged]: GitMerge,
  [EPullRequestGlyph.Closed]: GitPullRequestClosed,
}

const toneColorOf = ({ tone, theme }: { tone: EPullRequestTone; theme: SemanticTheme }): string => {
  if (tone === EPullRequestTone.Open) return theme.prOpen
  if (tone === EPullRequestTone.Merged) return theme.prMerged
  if (tone === EPullRequestTone.Closed) return theme.prClosed
  if (tone === EPullRequestTone.Queued) return theme.prQueued
  return theme.mutedForeground
}

const labelOf = ({ number, display }: { number: number; display: PullRequestDisplay }): string => {
  const parts = [`Pull request #${number}`, display.stateWord]
  if (display.conflict) parts.push('merge conflicts')
  if (display.autoMerge) parts.push('auto-merge on')
  return parts.join(', ')
}

const Segment = ({
  count,
  color,
  icon,
  spinning = false,
}: {
  count: number
  color: string
  icon: LucideIcon
  spinning?: boolean
}) => {
  const glyph = <Icon icon={icon} color={color} size={12} />
  return (
    <View style={styles.segment}>
      <Text size={ETextRole.Xs} family={EFontFamily.Mono} color={color}>
        {count}
      </Text>
      {spinning ? <Spinning>{glyph}</Spinning> : glyph}
    </View>
  )
}

const Checks = ({
  checks,
  theme,
}: {
  checks: PullRequestChecksTally | EChecksSummary
  theme: SemanticTheme
}) => {
  if (!isChecksTally(checks)) {
    return (
      <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
        {checks === EChecksSummary.None ? 'No checks' : 'Checks unknown'}
      </Text>
    )
  }
  return (
    <View style={styles.checks}>
      {checks.running > 0 ? (
        <Segment count={checks.running} color={theme.warning} icon={LoaderCircle} spinning />
      ) : null}
      {checks.passed > 0 ? (
        <Segment count={checks.passed} color={theme.success} icon={Check} />
      ) : null}
      {checks.failed > 0 ? (
        <Segment count={checks.failed} color={theme.destructive} icon={X} />
      ) : null}
      {checks.expected > 0 ? (
        <Segment count={checks.expected} color={theme.mutedForeground} icon={Clock} />
      ) : null}
    </View>
  )
}

export const PullRequestChip = ({ pullRequest }: { pullRequest: SessionPullRequest }) => {
  const theme = useTheme()
  const display = pullRequestDisplayOf(pullRequest)
  const color = toneColorOf({ tone: display.tone, theme })
  return (
    <View style={styles.row}>
      <Icon icon={GLYPH_ICON[display.glyph]} color={color} size={16} />
      <Text
        size={ETextRole.Xs}
        family={EFontFamily.Mono}
        tone={ETextTone.Muted}
        accessibilityLabel={labelOf({ number: pullRequest.number, display })}
      >
        #{pullRequest.number}
      </Text>
      {display.conflict ? <Icon icon={TriangleAlert} color={theme.warning} size={12} /> : null}
      {display.autoMerge ? (
        <Icon icon={FastForward} color={theme.mutedForeground} size={12} />
      ) : null}
      {display.settled ? null : <Checks checks={display.checks} theme={theme} />}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
  },
  checks: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
})
