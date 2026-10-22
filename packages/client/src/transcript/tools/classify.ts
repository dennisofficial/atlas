/**
 * The registry: every tool call, read once, before anything groups it.
 *
 * Grouping, phrasing, the right-hand measure and the expanded renderer all read from ONE
 * classification, so a tool that wants a different treatment is a single entry here rather than an
 * edit in four files that will disagree the first time somebody touches one.
 */

import { ECallState, type ToolCall } from '../tool-runs'
import { awaitingApproval, denied, failed } from './call-state'
import { agentCall } from './agents'
import { readShell } from './bash'
import { imageRead } from './images'
import { changed, pending } from './classify-change'
import { memoryCall } from './memory'
import { EDetail, EGather, EToolClass, type Classification } from './kinds'
import {
  commandLabel,
  count,
  detailOf,
  dictatedContentOf,
  diffStatOf,
  hostOf,
  inputOf,
  lineCount,
  num,
  outputOf,
  plural,
  records,
  relativise,
  standing,
  str,
  strings,
  targetOf,
} from './reading'

const MCP_SEPARATOR = '__'

function gatheredByName(args: { call: ToolCall; cwd: string }): Classification | null {
  const { call } = args
  const output = outputOf(call)
  const found = targetOf(args)
  const target = found ?? call.name

  if (call.name === 'read') {
    const picture = imageRead(args)
    if (picture !== null) return picture

    const path = relativise(str(output.path) ?? target, args.cwd)
    const lines = num(output.lines) ?? lineCount(call.modelText)
    return {
      klass: EToolClass.Gathered,
      gather: EGather.Read,
      line: path,
      ...standing({ verb: 'Read', target: found === undefined ? undefined : path }),
      failed: false,
      note: `${count(lines)} l`,
      metric: lines,
      detail: EDetail.File,
    }
  }

  if (call.name === 'grep') {
    const matches = strings(output.matches).length
    return {
      klass: EToolClass.Gathered,
      gather: EGather.Search,
      line: target,
      ...standing({ verb: 'Searched for', target: found }),
      failed: false,
      note: plural(matches, 'match', 'matches'),
      metric: matches,
      detail: EDetail.Matches,
    }
  }

  if (call.name === 'glob') {
    const paths = strings(output.paths).length
    return {
      klass: EToolClass.Gathered,
      gather: EGather.List,
      line: target,
      ...standing({ verb: 'Matched', target: found }),
      failed: false,
      note: plural(paths, 'path'),
      metric: null,
      detail: EDetail.Paths,
    }
  }

  if (call.name === 'web_fetch') {
    const host = hostOf(str(output.finalUrl) ?? str(inputOf(call).url) ?? '')
    const matched = num(output.matched)
    return {
      klass: EToolClass.Gathered,
      gather: EGather.Browse,
      line: host,
      ...standing({ verb: 'Read', target: host }),
      failed: false,
      note:
        matched === undefined
          ? output.truncated === true
            ? 'cut'
            : 'read'
          : plural(matched, 'match', 'matches'),
      metric: null,
      detail: EDetail.Page,
    }
  }

  if (call.name === 'web_search') {
    const query = str(inputOf(call).query) ?? target
    const results = records(output.results).length
    return {
      klass: EToolClass.Gathered,
      gather: EGather.Browse,
      line: query,
      ...standing({ verb: 'Searched the web for', target: query }),
      failed: false,
      note: plural(results, 'result'),
      metric: null,
      detail: EDetail.Results,
    }
  }

  if (call.name === 'shell_output' || call.name === 'shell_list') {
    const quiet = detailOf(call).join('').trim().length === 0
    return {
      klass: EToolClass.Gathered,
      gather: EGather.Watch,
      line: target,
      ...standing({ verb: 'Checked', target: found }),
      failed: false,
      note: quiet ? 'quiet' : `${count(lineCount(str(output.text) ?? ''))} l`,
      metric: null,
      detail: EDetail.Output,
    }
  }

  return null
}

export function classify(args: { call: ToolCall; cwd: string }): Classification {
  const { call } = args
  if (call.state === ECallState.Denied) return denied(args)
  if (call.state === ECallState.AwaitingApproval) return awaitingApproval(args)
  if (call.state === ECallState.Pending) return pending(args)
  if (call.state === ECallState.Failed && call.note !== null) return failed(args)

  if (call.name.includes(MCP_SEPARATOR)) {
    return {
      klass: EToolClass.External,
      gather: null,
      line: `Called ${call.name.split(MCP_SEPARATOR).at(-1) ?? call.name}`,
      failed: call.state !== ECallState.Ok,
      note: call.state === ECallState.Ok ? 'done' : 'failed',
      metric: null,
      detail: EDetail.Output,
    }
  }

  const remembered = memoryCall(call)
  if (remembered !== null) return remembered

  if (call.name === 'edit' || call.name === 'multi_edit' || call.name === 'write') {
    return changed(args)
  }

  if (call.name === 'bash') {
    const output = outputOf(call)
    const exitCode = num(output.exitCode) ?? null
    return readShell({
      command: str(output.command) ?? str(inputOf(call).command) ?? commandLabel(call),
      description: str(inputOf(call).description) ?? '',
      stdout: str(output.stdout) ?? '',
      exitCode,
      ok: call.state === ECallState.Ok && (exitCode ?? 0) === 0,
    })
  }

  const byName = gatheredByName(args)
  if (byName !== null) return byName

  if (call.name === 'shell_kill') {
    return {
      klass: EToolClass.Command,
      gather: null,
      line: `Killed ${targetOf(args) ?? 'a shell'}`,
      failed: call.state !== ECallState.Ok,
      note: call.state === ECallState.Ok ? 'killed' : 'failed',
      metric: null,
      detail: EDetail.None,
    }
  }

  if (call.name === 'task_write') {
    return {
      klass: EToolClass.Plan,
      gather: null,
      line: 'Updated the plan',
      failed: false,
      note: plural(records(outputOf(call).tasks).length, 'task'),
      metric: null,
      detail: EDetail.Plan,
    }
  }

  if (call.name === 'skill') {
    const named = str(outputOf(call).name) ?? targetOf(args)
    const lines = lineCount(detailOf(call).join('\n'))
    return {
      klass: EToolClass.External,
      gather: null,
      line: named === undefined ? 'Loaded a skill' : `Loaded the ${named} skill`,
      failed: call.state !== ECallState.Ok,
      note: call.state === ECallState.Ok ? `${count(lines)} l` : 'failed',
      metric: lines,
      detail: EDetail.File,
    }
  }

  const child = agentCall(args)
  if (child !== null) return child

  return {
    klass: EToolClass.External,
    gather: null,
    line: `Called ${call.name}`,
    failed: call.state !== ECallState.Ok,
    note: call.state === ECallState.Ok ? 'done' : 'failed',
    metric: null,
    detail: detailOf(call).length > 0 ? EDetail.Output : EDetail.None,
  }
}
