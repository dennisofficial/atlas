import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { EPullRequestState, EWorkKind, type SessionWork } from './session-groups'

const pullRequestGlyphOf = ({
  state,
  theme,
}: {
  state: EPullRequestState
  theme: SemanticTheme
}) => {
  if (state === EPullRequestState.Merged) return { icon: GitMerge, color: theme.prMerged }
  if (state === EPullRequestState.Closed)
    return { icon: GitPullRequestClosed, color: theme.prClosed }
  if (state === EPullRequestState.Draft) return { icon: GitPullRequestDraft, color: theme.prDraft }
  return { icon: GitPullRequest, color: theme.prOpen }
}

export const WorkSummary = ({ work }: { work: SessionWork }) => {
  const theme = useTheme()
  if (work.kind === EWorkKind.Branch) {
    return (
      <View style={styles.row}>
        <Icon icon={GitBranch} color={theme.mutedForeground} size={16} />
        <Text
          size={ETextRole.Xs}
          family={EFontFamily.Mono}
          tone={ETextTone.Muted}
          numberOfLines={1}
          style={styles.label}
        >
          {work.branch ?? 'No branch yet'}
        </Text>
      </View>
    )
  }
  const glyph = pullRequestGlyphOf({ state: work.state, theme })
  return (
    <View style={styles.row}>
      <Icon icon={glyph.icon} color={glyph.color} size={16} />
      <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
        #{work.number}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
  },
  label: {
    flexShrink: 1,
  },
})
