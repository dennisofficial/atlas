import { ECallState, type ToolCall } from '../tool-runs'
import { EDetail, EGather, EToolClass, type Classification } from './kinds'
import { count, inputOf, lineCount, num, outputOf, str } from './reading'

const subjectOf = (call: ToolCall): string => str(inputOf(call).name) ?? 'a memory'

const MEMORY_TOOLS: ReadonlySet<string> = new Set([
  'memory',
  'read_memory',
  'write_memory',
  'edit_memory',
  'delete_memory',
])

export const isMemoryTool = (name: string): boolean => MEMORY_TOOLS.has(name)

function recalled(call: ToolCall): Classification {
  const subject = subjectOf(call)
  const lines = num(outputOf(call).lines) ?? lineCount(call.modelText)

  return {
    klass: EToolClass.Gathered,
    gather: EGather.Recall,
    line: `Recalled ${subject}`,
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

const remembered = (subject: string): Classification =>
  changed({ line: `Remembered ${subject}`, note: 'saved', detail: EDetail.Created })

const revised = (subject: string): Classification =>
  changed({ line: `Revised ${subject}`, note: 'saved', detail: EDetail.None })

const forgot = (subject: string): Classification =>
  changed({ line: `Forgot ${subject}`, note: 'forgotten', detail: EDetail.None })

const actionCall = (call: ToolCall, subject: string): Classification | null => {
  switch (str(inputOf(call).action)) {
    case 'read':
      return recalled(call)
    case 'write':
      return remembered(subject)
    case 'edit':
      return revised(subject)
    case 'delete':
      return forgot(subject)
    default:
      return null
  }
}

export function memoryCall(call: ToolCall): Classification | null {
  if (call.state !== ECallState.Ok) return null

  switch (call.name) {
    case 'read_memory':
      return recalled(call)
    case 'write_memory':
      return remembered(subjectOf(call))
    case 'edit_memory':
      return revised(subjectOf(call))
    case 'delete_memory':
      return forgot(subjectOf(call))
    case 'memory':
      return actionCall(call, subjectOf(call))
    default:
      return null
  }
}
