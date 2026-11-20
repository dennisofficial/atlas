import { join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type DaemonEventFrame } from '@dltech/atlas-protocol'

import { discoverRepoAgentTypes, REPO_AGENT_ROOTS } from './repo-agent-types'
import type { CrewPodState } from './state'

type Ctx = Pick<PluginPodContext, 'call' | 'log' | 'onDaemonEvent' | 'sessionId'>

type ReadArgs = { ctx: Ctx; state: CrewPodState; directory: string; generation: number }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const watchIdOf = (sessionId: string): string => `crew:${sessionId}`

const rootsOf = (directory: string): readonly string[] =>
  REPO_AGENT_ROOTS.map((root) => join(directory, root))

const read = async (args: ReadArgs): Promise<void> => {
  const found = await discoverRepoAgentTypes({
    ctx: args.ctx,
    projectDirectory: args.directory,
  })
  if (args.state.generation !== args.generation) return
  args.state.types = found.types
  args.state.refusals = found.refusals
}

const queueRead = (args: ReadArgs): void => {
  const watch = args.state.watch
  if (watch === null || watch.generation !== args.generation) return
  watch.pending = watch.pending
    .then(() => read(args))
    .catch((error: unknown) => {
      args.ctx.log(`the repository agent types could not be re-read: ${messageOf(error)}`)
    })
}

const armedOf = async (args: { ctx: Ctx; roots: readonly string[] }): Promise<boolean> => {
  for (const root of args.roots) {
    const found = await args.ctx.call({ op: 'stat', path: root })
    if (found.status !== ECallStatus.Ok || found.op !== 'stat' || !found.value.isDirectory)
      return false
  }
  return true
}

const stopWatch = async (args: { ctx: Ctx; state: CrewPodState }): Promise<void> => {
  const watch = args.state.watch
  if (watch === null) return
  watch.off()
  args.state.watch = null
  await args.ctx.call({ op: 'watch.stop', watchId: watch.watchId })
}

const startWatch = async (args: {
  ctx: Ctx
  state: CrewPodState
  directory: string
  generation: number
}): Promise<void> => {
  const watchId = watchIdOf(args.ctx.sessionId)
  const roots = rootsOf(args.directory)
  const started = await args.ctx.call({
    op: 'watch.start',
    watchId,
    roots: [...roots],
  })
  if (started.status !== ECallStatus.Ok || started.op !== 'watch.start') {
    args.ctx.log(
      `the repository agent types are not watched: ${
        started.status === ECallStatus.Ok ? 'the daemon answered another op' : started.error.message
      }`,
    )
    return
  }
  const off = args.ctx.onDaemonEvent((frame: DaemonEventFrame) => {
    const event = frame.event
    if (event.type !== 'watch.changed' || event.watchId !== watchId) return
    queueRead(args)
  })
  args.state.watch = {
    directory: args.directory,
    watchId,
    generation: args.generation,
    armed: await armedOf({ ctx: args.ctx, roots }),
    off,
    pending: Promise.resolve(),
  }
}

export const syncRepoAgentTypes = async (args: {
  ctx: Ctx
  state: CrewPodState
  directory: string
}): Promise<void> => {
  const { state } = args
  if (state.directory !== args.directory) {
    state.directory = args.directory
    state.generation += 1
    await stopWatch(args)
    await startWatch({ ...args, generation: state.generation })
    await read({ ...args, generation: state.generation })
    return
  }

  const watch = state.watch
  if (watch?.armed === true) return

  const armed = await armedOf({ ctx: args.ctx, roots: rootsOf(args.directory) })
  if (watch !== null && !armed) return
  if (watch !== null) await stopWatch(args)
  await startWatch({ ...args, generation: state.generation })
  await read({ ...args, generation: state.generation })
}
