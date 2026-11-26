import { EEntryKind } from '@dltech/atlas-client/transcript'
import { space } from '@dltech/atlas-ui/tokens'
import { Reasoning, Step, Trace, useTheme, Spinner } from '@dltech/atlas-ui-native'
import { StyleSheet, View } from 'react-native'

import type { WorkItem, WorkRow } from '../rows'
import { ToolRowView } from './tool-row'

const labelOf = (row: WorkRow): string => {
  if (row.elapsed.length === 0) return row.running ? 'Working' : 'Worked'
  return row.running ? `Working for ${row.elapsed}` : `Worked for ${row.elapsed}`
}

const stepsLabelOf = (count: number): string => `${count} ${count === 1 ? 'step' : 'steps'}`

const ItemView = ({
  item,
  onOpenAgent,
}: {
  item: WorkItem
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  if (item.kind === EEntryKind.ToolsRan) {
    return (
      <View style={styles.tools}>
        {item.run.calls.map((call) => (
          <ToolRowView key={call.callId} call={call} onOpenAgent={onOpenAgent} />
        ))}
      </View>
    )
  }
  return <Reasoning text={item.text} live={item.streaming} />
}

export const WorkRowView = ({
  row,
  onOpenAgent,
}: {
  row: WorkRow
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  const theme = useTheme()
  return (
    <Trace>
      <Step
        icon={row.running ? <Spinner color={theme.mutedForeground} /> : undefined}
        title={labelOf(row)}
        description={stepsLabelOf(row.stepCount)}
        autoOpen={row.running}
      >
        {row.items.map((item) => (
          <ItemView key={item.id} item={item} onOpenAgent={onOpenAgent} />
        ))}
      </Step>
    </Trace>
  )
}

const styles = StyleSheet.create({
  tools: {
    gap: space(2),
  },
})
