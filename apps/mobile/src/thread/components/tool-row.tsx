import {
  callKindOf,
  classify,
  ECallKind,
  ECallState,
  formatElapsed,
  type ToolCall,
} from '@dltech/atlas-client/transcript'
import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  EFontFamily,
  ETextRole,
  ETextTone,
  ETraceStatus,
  Step,
  Text,
  Trace,
  useTheme,
} from '@dltech/atlas-ui-native'
import {
  Bot,
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react-native'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'

import { McpServerMark } from './mcp-server-mark'
import { AgentOpenLink } from './agent-open-link'
import { agentIdOfSpawnCall } from '../v2/agent-links'

const OUTPUT_MAX_HEIGHT = 240

const isOpen = (call: ToolCall): boolean =>
  call.state === ECallState.Pending || call.state === ECallState.AwaitingApproval

const ICON_OF_KIND: Record<ECallKind, typeof FileText> = {
  [ECallKind.Shell]: Terminal,
  [ECallKind.Read]: FileText,
  [ECallKind.Search]: Search,
  [ECallKind.Edit]: FilePen,
  [ECallKind.Web]: Globe,
  [ECallKind.Skill]: Sparkles,
  [ECallKind.Agent]: Bot,
  [ECallKind.Plan]: ListChecks,
  [ECallKind.Other]: Wrench,
}

const elapsedOf = (call: ToolCall): string => {
  if (call.at === null || call.settledAt === null) return ''
  const started = Date.parse(call.at)
  const settled = Date.parse(call.settledAt)
  if (Number.isNaN(started) || Number.isNaN(settled)) return ''
  return formatElapsed(Math.max(0, settled - started))
}

/** `Paper Get guide` — the server in the foreground, the tool in the trace's muted colour. */
const McpTitle = ({ mcp, failed }: { mcp: { server: string; tool: string }; failed: boolean }) => (
  <>
    <Text size={ETextRole.Sm} tone={failed ? ETextTone.Destructive : ETextTone.Foreground}>
      {mcp.server}
    </Text>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      {` ${mcp.tool}`}
    </Text>
  </>
)

export const ToolRowView = ({
  call,
  onOpenAgent,
}: {
  call: ToolCall
  onOpenAgent?: ((agentId: string) => void) | undefined
}) => {
  const theme = useTheme()
  const { line, note, failed, mcp } = classify({ call, cwd: '' })
  const output = call.liveOutput ?? call.modelText
  const hasOutput = output.length > 0
  const Glyph = ICON_OF_KIND[callKindOf(call.name)]
  const elapsed = elapsedOf(call)
  const description = elapsed.length > 0 ? elapsed : note
  const status = failed ? ETraceStatus.Error : isOpen(call) ? ETraceStatus.Running : undefined
  const agentId = agentIdOfSpawnCall(call)
  const handleOpenAgent =
    agentId === undefined || onOpenAgent === undefined ? undefined : () => onOpenAgent(agentId)
  const icon = isOpen(call) ? (
    <ActivityIndicator size="small" color={theme.mutedForeground} />
  ) : mcp !== undefined ? (
    <McpServerMark server={mcp.server} />
  ) : (
    <Glyph size={16} color={failed ? theme.destructive : theme.mutedForeground} />
  )

  return (
    <Trace>
      <Step
        icon={icon}
        title={mcp === undefined ? line : <McpTitle mcp={mcp} failed={failed} />}
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
      {handleOpenAgent === undefined ? null : <AgentOpenLink onPress={handleOpenAgent} />}
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
