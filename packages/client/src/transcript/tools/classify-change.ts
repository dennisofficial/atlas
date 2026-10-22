import type { ToolCall } from '../tool-runs'
import { EDetail, EGather, EToolClass, type Classification } from './kinds'
import {
  count,
  dictatedContentOf,
  diffStatOf,
  inputOf,
  num,
  outputOf,
  relativise,
  str,
  targetOf,
} from './reading'

/**
 * A command the model has not finished dictating, opened onto the terminal it will run in.
 *
 * The command is on the CALL, so it types into the panel as the arguments arrive and stays up while
 * the command runs — a long command no longer reads as dead air either.
 */
function dictatingShell(args: { call: ToolCall; cwd: string }): Classification | null {
  if (str(inputOf(args.call).command) === undefined) return null

  return {
    klass: EToolClass.Command,
    gather: null,
    line: targetOf(args) ?? args.call.name,
    failed: false,
    note: '',
    metric: null,
    detail: EDetail.Terminal,
  }
}

/**
 * A write or edit the model has not finished dictating, opened onto the text it is dictating.
 *
 * The content is on the CALL, so the same panel the settled row gets can be drawn from arguments
 * that are still arriving — which is the whole reason a long write no longer reads as dead air.
 */
function dictating(args: { call: ToolCall; cwd: string }): Classification | null {
  if (args.call.name === 'bash') return dictatingShell(args)
  if (dictatedContentOf(args.call) === undefined) return null

  const verb = args.call.name === 'edit' ? 'Editing' : 'Writing'
  return {
    klass: EToolClass.Change,
    gather: null,
    line: `${verb} ${targetOf(args) ?? args.call.name}`,
    failed: false,
    note: '',
    metric: null,
    detail: EDetail.Created,
  }
}

export const pending = (args: { call: ToolCall; cwd: string }): Classification =>
  dictating(args) ?? {
    klass: EToolClass.Gathered,
    gather: EGather.Run,
    line: targetOf(args) ?? args.call.name,
    failed: false,
    note: '',
    metric: null,
    detail: EDetail.None,
  }

/** A patch when the tool sent one, and the counts it reported when it did not. */
function statOf(call: ToolCall): { added: number; removed: number } | null {
  const patch = diffStatOf(call)
  if (patch !== null) return patch

  const output = outputOf(call)
  const added = num(output.added)
  const removed = num(output.removed)
  if (added === undefined && removed === undefined) return null
  return { added: added ?? 0, removed: removed ?? 0 }
}

export function changed(args: { call: ToolCall; cwd: string }): Classification {
  const output = outputOf(args.call)
  const path = relativise(str(output.path) ?? targetOf(args) ?? args.call.name, args.cwd)
  const stat = statOf(args.call)
  const detail = diffStatOf(args.call) === null ? EDetail.None : EDetail.Diff

  if (args.call.name === 'write') {
    const created = output.created === true
    // A write sends no patch, but the CONTENT is on the call — so a created file still has something
    // to show, in the panel an edit's diff would have taken.
    const wrote = str(inputOf(args.call).content) !== undefined
    return {
      klass: EToolClass.Change,
      gather: null,
      line: `${created ? 'Created' : 'Wrote'} ${path}`,
      failed: false,
      note: created ? 'new' : `${count(num(output.bytes) ?? 0)} B`,
      metric: null,
      detail: detail === EDetail.Diff ? detail : wrote ? EDetail.Created : EDetail.None,
    }
  }

  return {
    klass: EToolClass.Change,
    gather: null,
    line: `Edited ${path}`,
    failed: false,
    note: stat === null ? 'edited' : `+${stat.added} −${stat.removed}`,
    metric: null,
    detail,
  }
}
