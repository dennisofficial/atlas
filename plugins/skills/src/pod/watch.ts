import { join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type DaemonEventFrame } from '@dltech/atlas-protocol'

import { type SkillCatalogue, skillsChangedOf } from './catalogue'
import { catalogueFor } from './catalogue-source'
import type { CloudSkillSource } from './port'
import { REPO_SKILL_ROOTS } from './repo-source'
import type { SkillsPodState } from './state'

type Ctx = Pick<PluginPodContext, 'call' | 'log' | 'onDaemonEvent' | 'append' | 'sessionId'>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const watchIdOf = (sessionId: string): string => `skills:${sessionId}`

const rootsOf = (directory: string): readonly string[] =>
  REPO_SKILL_ROOTS.map((root) => join(directory, root))

export const emitSkillsChanged = async (args: {
  ctx: Pick<PluginPodContext, 'append'>
  catalogue: SkillCatalogue | null
}): Promise<void> => {
  if (args.catalogue === null) return
  await args.ctx.append([skillsChangedOf(args.catalogue)])
}

const refresh = async (args: {
  ctx: Ctx
  state: SkillsPodState
  cloud: CloudSkillSource
  directory: string
}): Promise<void> => {
  args.state.catalogue = null
  const catalogue = await catalogueFor({
    ctx: args.ctx,
    state: args.state,
    cloud: args.cloud,
    directory: args.directory,
    refresh: true,
  })
  await emitSkillsChanged({ ctx: args.ctx, catalogue })
}

const queueRefresh = (args: {
  ctx: Ctx
  state: SkillsPodState
  cloud: CloudSkillSource
  directory: string
}): void => {
  const watch = args.state.watch
  if (watch === null) return
  watch.pending = watch.pending
    .then(() => refresh(args))
    .catch((error: unknown) => {
      args.ctx.log(`skills could not be re-read after a change: ${messageOf(error)}`)
    })
}

const stopWatch = async (args: { ctx: Ctx; state: SkillsPodState }): Promise<void> => {
  const watch = args.state.watch
  if (watch === null) return
  watch.off()
  args.state.watch = null
  await args.ctx.call({ op: 'watch.stop', watchId: watch.watchId })
}

export const watchSkills = async (args: {
  ctx: Ctx
  state: SkillsPodState
  cloud: CloudSkillSource
  directory: string
}): Promise<boolean> => {
  if (args.state.watch?.directory === args.directory) return false
  await stopWatch(args)

  const watchId = watchIdOf(args.ctx.sessionId)
  const started = await args.ctx.call({
    op: 'watch.start',
    watchId,
    roots: [...rootsOf(args.directory)],
  })
  if (started.status !== ECallStatus.Ok || started.op !== 'watch.start') {
    args.ctx.log(
      `skills are not watched: ${started.status === ECallStatus.Ok ? 'the daemon answered another op' : started.error.message}`,
    )
    return false
  }

  const off = args.ctx.onDaemonEvent((frame: DaemonEventFrame) => {
    const event = frame.event
    if (event.type !== 'watch.changed' || event.watchId !== watchId) return
    queueRefresh(args)
  })
  args.state.watch = { directory: args.directory, watchId, off, pending: Promise.resolve() }
  return true
}
