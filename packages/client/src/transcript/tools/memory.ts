import { ECallState, type ToolCall } from '../tool-runs'
import { EDetail, EGather, EToolClass, type Classification } from './kinds'
import { count, inputOf, lineCount, num, outputOf, str } from './reading'

const subjectOf = (call: ToolCall): string => str(inputOf(call).name) ?? 'a memory'

function recalled(call: ToolCall): Classification {
  const subject = subjectOf(call)
  const lines = num(outputOf(call).lines) ?? lineCount(call.modelText)

  return {
    klass: EToolClass.Gathered,
    gather: EGather.Recall,
    line: subject,
    alone: `Recalled ${subject}`,
    failed: false,
    note: `${count(lines)} l`,
    metric: lines,
    detail: EDetail.File,
  }
}

const changed = (args: { line: string; note: string; detail: EDetail }): Classification => ({
  klass: EToolClass.Change,
  gather: null,
  line: args.line,
  failed: false,
  note: args.note,
  metric: null,
  detail: args.detail,
})

export function memoryCall(call: ToolCall): Classification | null {
  if (call.state !== ECallState.Ok) return null
  const subject = subjectOf(call)

  switch (call.name) {
    case 'read_memory':
      return recalled(call)
    case 'write_memory':
      return changed({ line: `Remembered ${subject}`, note: 'saved', detail: EDetail.Created })
    case 'edit_memory':
      return changed({ line: `Revised ${subject}`, note: 'saved', detail: EDetail.None })
    case 'delete_memory':
      return changed({ line: `Forgot ${subject}`, note: 'forgotten', detail: EDetail.None })
    default:
      return null
  }
}
