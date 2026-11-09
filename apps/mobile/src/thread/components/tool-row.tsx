import {
  classify,
  ECallState,
  EToolClass,
  formatElapsed,
  type ToolCall,
} from '@dltech/atlas-client/transcript'
import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  EFontFamily,
  ETextRole,
  ETraceStatus,
  Step,
  Text,
  Trace,
  useTheme,
} from '@dltech/atlas-ui-native'
import { FilePen, FileText, ListChecks, Terminal, Wrench } from 'lucide-react-native'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'

const OUTPUT_MAX_HEIGHT = 240

const isOpen = (call: ToolCall): boolean =>
  call.state === ECallState.Pending || call.state === ECallState.AwaitingApproval

const ICON_OF_CLASS: Record<EToolClass, typeof FileText> = {
  [EToolClass.Gathered]: FileText,
  [EToolClass.Change]: FilePen,
  [EToolClass.Command]: Terminal,
  [EToolClass.External]: Wrench,
  [EToolClass.Plan]: ListChecks,
}

const elapsedOf = (call: ToolCall): string => {
  if (call.at === null || call.settledAt === null) return ''
  const started = Date.parse(call.at)
  const settled = Date.parse(call.settledAt)
  if (Number.isNaN(started) || Number.isNaN(settled)) return ''
  return formatElapsed(Math.max(0, settled - started))
}

export const ToolRowView = ({ call }: { call: ToolCall }) => {
  const theme = useTheme()
  const { klass, line, note, failed } = classify({ call, cwd: '' })
  const output = call.liveOutput ?? call.modelText
  const hasOutput = output.length > 0
  const Glyph = ICON_OF_CLASS[klass]
  const elapsed = elapsedOf(call)
  const description = elapsed.length > 0 ? elapsed : note
  const status = failed ? ETraceStatus.Error : isOpen(call) ? ETraceStatus.Running : undefined
  const icon = isOpen(call) ? (
    <ActivityIndicator size="small" color={theme.mutedForeground} />
  ) : (
    <Glyph size={16} color={failed ? theme.destructive : theme.mutedForeground} />
  )

  return (
    <Trace>
      <Step
        icon={icon}
        title={line}
        description={description}
        status={status}
        defaultOpen={failed && hasOutput}
      >
        {hasOutput ? (
          <ScrollView
            nestedScrollEnabled
            style={[styles.output, { backgroundColor: theme.muted }]}
            contentContainerStyle={styles.outputContent}
          >
            <Text size={ETextRole.Xs} family={EFontFamily.Mono} leading={1.625} selectable>
              {output}
            </Text>
          </ScrollView>
        ) : undefined}
      </Step>
    </Trace>
  )
}

const styles = StyleSheet.create({
  output: {
    borderRadius: radius(0.8),
    maxHeight: OUTPUT_MAX_HEIGHT,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  outputContent: {
    flexGrow: 0,
  },
})
