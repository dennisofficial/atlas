import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { finishedRunErrorOf } from '../core'
import { runGh } from './gh'

type GhCtx = Pick<PluginPodContext, 'call'>

const GITHUB_HOST = 'github.com'

const RUN_VIEW_FIELDS = 'status,conclusion,name,path,headBranch,url'

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const runViewArgv = (args: { repo: string; runId: number }): readonly string[] => [
  'run',
  'view',
  String(args.runId),
  '-R',
  args.repo.slice(GITHUB_HOST.length + 1),
  '--json',
  RUN_VIEW_FIELDS,
]

type RunView = {
  status: string
  conclusion: string
  name: string
  path: string
  headBranch: string
  url: string
}

const stringFieldOf = (value: unknown): string => (typeof value === 'string' ? value : '')

export const runViewOf = (text: string): RunView | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const status = stringFieldOf(record['status'])
  if (status.length === 0) return null
  return {
    status,
    conclusion: stringFieldOf(record['conclusion']),
    name: stringFieldOf(record['name']),
    path: stringFieldOf(record['path']),
    headBranch: stringFieldOf(record['headBranch']),
    url: stringFieldOf(record['url']),
  }
}

const workflowHintOf = (view: RunView): string => {
  const fromPath = basenameOf(view.path)
  return fromPath.length > 0 ? fromPath : view.name
}

export const finishedRunRefusal = async (args: {
  ctx: GhCtx
  cwd?: string | undefined
  repo: string
  runId: number
}): Promise<{ error: string } | null> => {
  const viewed = await runGh({
    ctx: args.ctx,
    cwd: args.cwd,
    argv: runViewArgv({ repo: args.repo, runId: args.runId }),
  })
  if (!viewed.ok) return null
  const view = runViewOf(viewed.text)
  if (view === null || view.status !== 'completed') return null
  return {
    error: finishedRunErrorOf({
      name: view.name.length === 0 ? `#${args.runId}` : view.name,
      conclusion: view.conclusion.length === 0 ? 'unknown' : view.conclusion,
      url: view.url,
      workflow: workflowHintOf(view),
      branch: view.headBranch,
    }),
  }
}
