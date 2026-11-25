import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { GitBranch } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { PullRequestChip } from './pull-request-chip'
import { EWorkKind, type SessionWork } from './session-groups'

export const WorkSummary = ({ work }: { work: SessionWork }) => {
  const theme = useTheme()
  if (work.kind === EWorkKind.PullRequest) {
    return (
      <View style={styles.row}>
        <PullRequestChip pullRequest={work.pullRequest} />
      </View>
    )
  }
  if (work.branch === null) return null
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
        {work.branch}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
  },
  label: {
    flexShrink: 1,
  },
})
