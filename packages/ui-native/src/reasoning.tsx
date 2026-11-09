import { space } from '@dltech/atlas-ui/tokens'
import { CircleCheck } from 'lucide-react-native'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { Text } from './text'
import { ETextRole, ETextTone, RELAXED_LEADING } from './text-style'
import { ETraceStatus, Step, Trace, TraceLine } from './trace'
import { useTheme } from './use-theme'

const TAIL_MAX_LINES = 4

export const Reasoning = ({ text, live = false }: { text: string; live?: boolean }) => {
  const theme = useTheme()
  if (live) {
    return (
      <Trace>
        <TraceLine
          icon={<ActivityIndicator size="small" color={theme.mutedForeground} />}
          title="Thinking"
          status={ETraceStatus.Running}
        />
        {text.length === 0 ? null : (
          <View style={[styles.tail, { borderLeftColor: theme.border }]}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} leading={RELAXED_LEADING}>
              {text}
            </Text>
          </View>
        )}
      </Trace>
    )
  }
  return (
    <Trace>
      <Step icon={<CircleCheck size={16} color={theme.mutedForeground} />} title="Thought">
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} leading={RELAXED_LEADING}>
          {text}
        </Text>
      </Step>
    </Trace>
  )
}

const styles = StyleSheet.create({
  tail: {
    borderLeftWidth: 1,
    justifyContent: 'flex-end',
    marginBottom: space(1),
    marginLeft: space(1.75),
    maxHeight: TAIL_MAX_LINES * 14 * RELAXED_LEADING,
    overflow: 'hidden',
    paddingLeft: space(4),
    paddingRight: space(1),
  },
})
