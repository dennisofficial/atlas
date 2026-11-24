import { ECloudSetting, readResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { watchIdOf } from '../plugin-resource-probes'
import { pluginResourcesHook } from '../plugin-resources'
import {
  DIRECTORY,
  THREAD,
  agentsRootOf,
  rig,
  snapshotEventOf,
  stringResource,
  versionsAt,
  type Rig,
} from './plugin-resources-rig'

type ResourceOptions = Parameters<typeof stringResource>[0]

const turnStartOf = async (turn: Rig): Promise<void> => {
  await pluginResourcesHook({ sync: turn.sync }).run({
    threadId: THREAD,
    projectDirectory: DIRECTORY,
  })
}

const gateOf = (): { promise: Promise<string>; open(value: string): void } => {
  let open = (_value: string): void => undefined
  const promise = new Promise<string>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('a cloud setting changed between two turns', () => {
  it('reads the versions once and loads nothing when no setting changed', async () => {
    const loads: string[] = []
    const instructions = stringResource({
      name: 'instructions',
      loads,
      value: () => 'personal',
      cloud: [ECloudSetting.PersonalInstructions],
    })
    const turn = rig({ resources: [instructions] })
    await turn.run()
    const reads = turn.daemon.versionReads()
    turn.calls.length = 0

    await turn.run()

    expect(turn.daemon.versionReads()).toBe(reads + 1)
    expect(turn.calls).toEqual([])
    expect(loads).toEqual(['instructions'])
  })

  it('reloads a changed personal instruction before the first model call', async () => {
    const loads: string[] = []
    let text = 'OLD INSTRUCTION'
    const instructions = stringResource({
      name: 'instructions',
      loads,
      value: () => text,
      cloud: [ECloudSetting.PersonalInstructions],
    })
    const turn = rig({ resources: [instructions] })
    await turn.run()
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('OLD INSTRUCTION')

    text = 'NEW INSTRUCTION'
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.PersonalInstructions]: 'v2' })
    await turnStartOf(turn)

    expect(loads).toEqual(['instructions', 'instructions'])
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('NEW INSTRUCTION')
    expect(turn.calls).toEqual([])
  })

  it('reloads a changed skills catalogue before the first model call', async () => {
    const loads: string[] = []
    let value = 'one'
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => value,
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({ resources: [skills] })
    await turn.run()

    value = 'two'
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })
    await turnStartOf(turn)

    expect(loads).toEqual(['skills', 'skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
  })

  it('awaits the mcp config and starts the mcp tools in the background', async () => {
    const loads: string[] = []
    let config = 'config v1'
    const configOptions: ResourceOptions = {
      name: 'mcp-config',
      loads,
      value: () => config,
      cloud: [ECloudSetting.McpServers],
    }
    const toolsOptions: ResourceOptions = {
      name: 'mcp-tools',
      loads,
      value: () => 'tools v1',
      cloud: [ECloudSetting.McpServers],
      background: true,
    }
    const configResource = stringResource(configOptions)
    const toolsResource = stringResource(toolsOptions)
    const turn = rig({ resources: [configResource, toolsResource] })
    await turn.run()

    const gate = gateOf()
    toolsOptions.pending = gate.promise
    config = 'config v2'
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.McpServers]: 'v2' })
    await turnStartOf(turn)

    expect(loads.filter((name) => name === 'mcp-config')).toHaveLength(2)
    expect(loads.filter((name) => name === 'mcp-tools')).toHaveLength(2)
    expect(readResource({ ctx: turn.ctx, resource: configResource })).toBe('config v2')
    expect(readResource({ ctx: turn.ctx, resource: toolsResource })).toBe('tools v1')

    gate.open('tools v2')
    await turn.settled()
    expect(readResource({ ctx: turn.ctx, resource: toolsResource })).toBe('tools v2')
  })

  it('reloads nothing when the versions read fails', async () => {
    const loads: string[] = []
    const instructions = stringResource({
      name: 'instructions',
      loads,
      value: () => 'personal',
      cloud: [ECloudSetting.PersonalInstructions],
    })
    const turn = rig({ resources: [instructions] })
    await turn.run()

    turn.daemon.failVersions(new Error('database gone'))
    await turnStartOf(turn)

    expect(loads).toEqual(['instructions'])
    expect(turn.logs.some((line) => line.includes('could not read cloud versions'))).toBe(true)
    expect(readResource({ ctx: turn.ctx, resource: instructions })).toBe('personal')
  })

  it('reads no versions for a resource that declares no cloud setting', async () => {
    const loads: string[] = []
    const index = stringResource({ name: 'memory-index', loads, value: () => 'index' })
    const turn = rig({ resources: [index] })
    await turn.run()
    turn.daemon.setVersions(versionsAt('v2'))

    await turnStartOf(turn)

    expect(turn.daemon.versionReads()).toBe(0)
    expect(loads).toEqual(['memory-index'])
  })

  it('loads once when the initial refresh already loaded the changed setting', async () => {
    const loads: string[] = []
    const podReady = gateOf()
    const skills = stringResource({
      name: 'skills',
      loads,
      value: () => 'two',
      watch: true,
      cloud: [ECloudSetting.Skills],
    })
    const turn = rig({
      resources: [skills],
      beforeCall: async () => {
        await podReady.promise
      },
    })
    turn.events.push(
      snapshotEventOf({
        resource: 'skills',
        fingerprint: `instance-0:0:v1:${DIRECTORY}`,
        value: 'one',
      }),
    )
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })

    turn.sync.start()
    const started = turnStartOf(turn)
    podReady.open('')
    await started
    await turn.settled()

    expect(loads).toEqual(['skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
  })

  it('reuses a reload its watch already started instead of loading twice', async () => {
    const loads: string[] = []
    const gate = gateOf()
    const options: ResourceOptions = {
      name: 'skills',
      loads,
      value: () => 'one',
      watch: true,
      cloud: [ECloudSetting.Skills],
    }
    const skills = stringResource(options)
    const turn = rig({ resources: [skills] })
    await turn.run()

    options.pending = gate.promise
    turn.daemon.setVersions({ ...versionsAt('v1'), [ECloudSetting.Skills]: 'v2' })
    turn.changed(watchIdOf({ roots: [agentsRootOf(DIRECTORY)] }))
    const started = turnStartOf(turn)
    gate.open('two')
    await started
    await turn.settled()

    expect(loads).toEqual(['skills', 'skills'])
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
  })
})
