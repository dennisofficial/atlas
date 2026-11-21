import { createHash } from 'node:crypto'

import { ECloudSetting, type PluginPodContext, type ResourceWatch } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

const WATCH_DEBOUNCE_MS = 150
const UNKNOWN = 'unknown'
const WATCH_ID_CHARS = 24

type Ctx = PluginPodContext

export const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const watchIdOf = (watch: ResourceWatch): string => {
  const spec = JSON.stringify({
    roots: [...watch.roots],
    basenames: watch.basenames === undefined ? null : [...watch.basenames].sort(),
  })
  const digest = createHash('sha256').update(spec).digest('hex').slice(0, WATCH_ID_CHARS)
  return `resource.${digest}`
}

const unknownVersions = (): Readonly<Record<ECloudSetting, string>> => ({
  [ECloudSetting.McpServers]: UNKNOWN,
  [ECloudSetting.Skills]: UNKNOWN,
  [ECloudSetting.PersonalInstructions]: UNKNOWN,
})

export const versionsOf = async (args: {
  ctx: Ctx
  needed: boolean
}): Promise<Readonly<Record<ECloudSetting, string>>> => {
  if (!args.needed) return unknownVersions()
  try {
    return await args.ctx.control.settingsVersions()
  } catch (failure) {
    args.ctx.log(`plugin resources could not read cloud versions: ${messageOf(failure)}`)
    return unknownVersions()
  }
}

export const cloudStringOf = (args: {
  settings: readonly ECloudSetting[] | undefined
  versions: Readonly<Record<ECloudSetting, string>>
}): string => {
  if (args.settings === undefined) return ''
  return Object.values(ECloudSetting)
    .filter((setting) => args.settings?.includes(setting) === true)
    .map((setting) => args.versions[setting])
    .join('|')
}

export const statusOf = async (args: {
  ctx: Ctx
  watchIds: readonly string[]
}): Promise<{ instance: string; seqs: ReadonlyMap<string, number> }> => {
  if (args.watchIds.length === 0) return { instance: UNKNOWN, seqs: new Map() }
  try {
    const result = await args.ctx.call({ op: 'watch.status', watchIds: [...args.watchIds] })
    if (result.status !== ECallStatus.Ok) throw new Error(result.error.message)
    if (result.op !== 'watch.status') throw new Error('the daemon answered another operation')
    return {
      instance: result.value.instance,
      seqs: new Map(result.value.watches.map((entry) => [entry.watchId, entry.seq])),
    }
  } catch (failure) {
    args.ctx.log(`plugin resources could not read watch status: ${messageOf(failure)}`)
    return { instance: UNKNOWN, seqs: new Map() }
  }
}

export const armOf = async (args: {
  ctx: Ctx
  watchId: string
  watch: ResourceWatch
}): Promise<void> => {
  try {
    await args.ctx.call({
      op: 'watch.start',
      watchId: args.watchId,
      roots: [...args.watch.roots],
      debounceMs: WATCH_DEBOUNCE_MS,
      ...(args.watch.basenames === undefined ? {} : { basenames: [...args.watch.basenames] }),
    })
  } catch (failure) {
    args.ctx.log(`plugin resources could not watch ${args.watchId}: ${messageOf(failure)}`)
  }
}
