import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, View } from 'react-native'

import { EWorkKind } from '../../sessions/session-groups'
import { WorkSummary } from '../../sessions/work-summary'
import type { SessionHeader } from '../session/session-header'

const WorkLine = ({ header }: { header: SessionHeader }) => {
  const work = header.work
  if (work.kind === EWorkKind.Branch) return <WorkSummary work={work} />
  const handleOpenPullRequest = () => void WebBrowser.openBrowserAsync(work.pullRequest.url)
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open pull request #${work.pullRequest.number}`}
      hitSlop={space(2)}
      onPress={handleOpenPullRequest}
      style={styles.pullRequest}
    >
      <WorkSummary work={work} />
    </Pressable>
  )
}

export const SessionTitle = ({ header }: { header: SessionHeader }) => (
  <View style={styles.root} accessibilityRole="header">
    <Text size={ETextRole.Sm} weight={EFontWeight.Medium} numberOfLines={1}>
      {header.title}
    </Text>
    <WorkLine header={header} />
  </View>
)

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    gap: space(0.5),
  },
  pullRequest: {
    alignItems: 'flex-start',
  },
})
