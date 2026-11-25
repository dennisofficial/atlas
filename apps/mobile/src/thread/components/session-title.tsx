import { EFontWeight, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, View } from 'react-native'

import { PullRequestChip } from '../../sessions/pull-request-chip'
import { StatusIcon } from '../../sessions/status-icon'
import type { SessionHeader } from '../v2/session-header'

export const SessionTitle = ({ header }: { header: SessionHeader }) => {
  const pullRequest = header.pullRequest
  const handleOpenPullRequest = () => {
    if (pullRequest === null) return
    void WebBrowser.openBrowserAsync(pullRequest.url)
  }
  return (
    <View style={styles.root} accessibilityRole="header">
      <Text size={ETextRole.Sm} weight={EFontWeight.Medium} numberOfLines={1}>
        {header.title}
      </Text>
      {header.subtitle === null ? null : (
        <View style={styles.state}>
          <StatusIcon status={header.display} unread={false} />
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
            {header.subtitle}
          </Text>
        </View>
      )}
      {pullRequest === null ? null : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open pull request #${pullRequest.number}`}
          hitSlop={space(2)}
          onPress={handleOpenPullRequest}
          style={styles.pullRequest}
        >
          <PullRequestChip pullRequest={pullRequest} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    gap: space(0.5),
    paddingHorizontal: space(1),
  },
  state: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
  },
  pullRequest: {
    alignItems: 'flex-start',
  },
})
