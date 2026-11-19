import type { ToolCall } from '../tool-runs'
import { EDetail, EToolClass, type Classification } from './kinds'
import { targetOf } from './reading'

export const awaitingApproval = (args: { call: ToolCall; cwd: string }): Classification => ({
  klass: EToolClass.Command,
  gather: null,
  line: `Waiting on you ${targetOf(args) ?? args.call.name}`.trim(),
  failed: false,
  note: 'approve?',
  metric: null,
  detail: args.call.note === null ? EDetail.None : EDetail.Reason,
})

export const denied = (args: { call: ToolCall; cwd: string }): Classification => ({
  klass: EToolClass.Command,
  gather: null,
  line: `Refused ${args.call.name} ${targetOf(args) ?? ''}`.trim(),
  failed: true,
  note: 'denied',
  metric: null,
  detail: args.call.note === null ? EDetail.None : EDetail.Reason,
})
