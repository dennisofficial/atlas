import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import * as WebBrowser from 'expo-web-browser'
import { Pressable, StyleSheet, View } from 'react-native'

import { HeaderTapShield, PASS_THROUGH } from '../../navigation/header-tap-shield'
import { EWorkKind } from '../../sessions/session-groups'
import { WorkSummary } from '../../sessions/work-summary'
import type { SessionHeader } from '../session/session-header'

const PULL_REQUEST_SLOP = space(2)

const WorkLine = ({ header }: { header: SessionHeader }) => {
  const work = header.work
  if (work.kind === EWorkKind.Branch)
    return (
      <View style={PASS_THROUGH}>
        <WorkSummary work={work} />
      </View>
    )
  const handleOpenPullRequest = () => void WebBrowser.openBrowserAsync(work.pullRequest.url)
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open pull request #${work.pullRequest.number}`}
      hitSlop={PULL_REQUEST_SLOP}
      onPress={handleOpenPullRequest}
      style={styles.pullRequest}
    >
      <WorkSummary work={work} />
      <HeaderTapShield slop={PULL_REQUEST_SLOP} />
    </Pressable>
  )
}

export const SessionTitle = ({ header }: { header: SessionHeader }) => (
  <View style={styles.root} accessibilityRole="header" pointerEvents="box-none">
    <Text
      size={ETextRole.Base}
      weight={EFontWeight.Semibold}
      numberOfLines={1}
      style={PASS_THROUGH}
    >
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
