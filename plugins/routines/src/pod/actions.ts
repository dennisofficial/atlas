import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { Routine } from '@dltech/atlas-protocol'

import { done, failed, routineRefusal } from './outcome'
import type { RoutineInput } from './schema'

const lineFor = (routine: Routine): string =>
  `${routine.routineId}  ${routine.name}  ${routine.cron} in ${routine.timezone}  ${
    routine.enabled ? 'enabled' : 'paused'
  }  next ${routine.nextRunAt}  last session ${routine.lastSessionId ?? 'none'}`

const summaryOf = (routine: Routine) => ({
  routineId: routine.routineId,
  name: routine.name,
  cron: routine.cron,
  timezone: routine.timezone,
  enabled: routine.enabled,
  nextRunAt: routine.nextRunAt,
  lastSessionId: routine.lastSessionId,
})

const settingsOf = (routine: Routine): string =>
  `model ${routine.model ?? 'from the project default'}, effort ${
    routine.effort ?? 'from the project default'
  }, fast ${routine.fast === null ? 'from the project default' : String(routine.fast)}`

const detailOf = (routine: Routine): ToolOutcome =>
  done({
    text: [
      `Routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, ${
        routine.enabled ? 'enabled' : 'paused'
      }, next run ${routine.nextRunAt}, last session ${routine.lastSessionId ?? 'none'}.`,
      `Settings: ${settingsOf(routine)}.`,
      `Prompt:\n${routine.prompt}`,
    ].join('\n'),
    output: routine,
  })

export const listRoutines = async (ctx: PluginPodContext): Promise<ToolOutcome> => {
  try {
    const routines = await ctx.control.routines.list()
    return done({
      text:
        routines.length === 0
          ? 'This project has no routines.'
          : `Routines:\n${routines.map(lineFor).join('\n')}`,
      output: { routines: routines.map(summaryOf) },
    })
  } catch (error) {
    return routineRefusal(error)
  }
}

export const getRoutine = async (args: {
  ctx: PluginPodContext
  input: RoutineInput
}): Promise<ToolOutcome> => {
  try {
    return detailOf(await args.ctx.control.routines.get({ routineId: args.input.routineId ?? '' }))
  } catch (error) {
    return routineRefusal(error)
  }
}

export const createRoutine = async (args: {
  ctx: PluginPodContext
  input: RoutineInput
}): Promise<ToolOutcome> => {
  const { input } = args
  try {
    const routine = await args.ctx.control.routines.create({
      name: input.name ?? '',
      prompt: input.prompt ?? '',
      cron: input.cron ?? '',
      timezone: input.timezone ?? '',
      ...(input.model === undefined || input.model === null ? {} : { model: input.model }),
      ...(input.effort === undefined || input.effort === null ? {} : { effort: input.effort }),
      ...(input.fast === undefined || input.fast === null ? {} : { fast: input.fast }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    })
    return done({
      text: `Created routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, next run ${routine.nextRunAt}${routine.enabled ? '' : ', paused'}.`,
      output: routine,
    })
  } catch (error) {
    return routineRefusal(error)
  }
}

export const updateRoutine = async (args: {
  ctx: PluginPodContext
  input: RoutineInput
}): Promise<ToolOutcome> => {
  const { input } = args
  try {
    const routine = await args.ctx.control.routines.update({
      routineId: input.routineId ?? '',
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.cron === undefined ? {} : { cron: input.cron }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      ...(input.fast === undefined ? {} : { fast: input.fast }),
    })
    return done({
      text: `Updated routine ${routine.name} (${routine.routineId}): "${routine.cron}" in ${routine.timezone}, ${routine.enabled ? 'enabled' : 'paused'}, next run ${routine.nextRunAt}.`,
      output: routine,
    })
  } catch (error) {
    return routineRefusal(error)
  }
}

export const deleteRoutine = async (args: {
  ctx: PluginPodContext
  input: RoutineInput
}): Promise<ToolOutcome> => {
  const routineId = args.input.routineId ?? ''
  try {
    const body = await args.ctx.control.routines.remove({ routineId })
    if (!body.removed) {
      return failed(`there is no routine "${routineId}" in this session's project`)
    }
    return done({ text: `Deleted routine ${routineId}.`, output: body })
  } catch (error) {
    return routineRefusal(error)
  }
}

export const runRoutine = async (args: {
  ctx: PluginPodContext
  input: RoutineInput
}): Promise<ToolOutcome> => {
  const routineId = args.input.routineId ?? ''
  try {
    const body = await args.ctx.control.routines.run({ routineId })
    return done({
      text: `Started routine ${routineId} now in session ${body.sessionId}.`,
      output: body,
    })
  } catch (error) {
    return routineRefusal(error)
  }
}
