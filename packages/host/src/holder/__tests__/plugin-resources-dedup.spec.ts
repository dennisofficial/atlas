import { ECloudSetting, PodRuntimeScope, type PodResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { watchIdOf } from '../plugin-resource-probes'
import { DIRECTORY, agentsRootOf, rig, stringResource, versionsAt } from './plugin-resources-rig'

const watchId = watchIdOf({ roots: [agentsRootOf(DIRECTORY)] })

const snapshotsOf = (turn: ReturnType<typeof rig>) =>
  turn.events.filter((event) => event.type === 'resource-loaded')

describe('unchanged plugin resources', () => {
  it('does not append an identical retry result', async () => {
    const loads: string[] = []
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads, value: () => 'one', stale: () => true })],
    })
    await turn.run()
    await turn.closed()
    await turn.closed()

    expect(loads).toEqual(['tools', 'tools', 'tools'])
    expect(turn.events).toHaveLength(1)
  })

  it('ignores object key order when comparing the newest value', async () => {
    let reversed = false
    const resource: PodResource<unknown> = {
      name: 'tools',
      schema: z.unknown(),
      stale: () => true,
      load: async () =>
        reversed
          ? { nested: { b: 2, a: 1 }, list: [1, 2] }
          : { list: [1, 2], nested: { a: 1, b: 2 } },
    }
    const turn = rig({ resources: [resource] })
    await turn.run()
    reversed = true
    await turn.closed()

    expect(turn.events).toHaveLength(1)
  })

  it('appends a changed value even under the same fingerprint', async () => {
    let value = 'one'
    const turn = rig({
      resources: [
        stringResource({ name: 'tools', loads: [], value: () => value, stale: () => true }),
      ],
    })
    await turn.run()
    value = 'two'
    await turn.closed()
    value = 'one'
    await turn.closed()

    expect(snapshotsOf(turn).map((event) => event.value)).toEqual(['one', 'two', 'one'])
  })

  it('does not append when only the watch sequence or daemon instance changed', async () => {
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads: [], value: () => 'one', watch: true })],
    })
    await turn.run()
    turn.daemon.seqs.set(watchId, 1)
    turn.changed(watchId)
    await turn.settled()
    turn.daemon.setInstance('instance-2')
    turn.reconnect(true)
    await turn.settled()

    expect(turn.events).toHaveLength(1)
  })

  it('settles unchanged watch reloads without another snapshot', async () => {
    const loads: string[] = []
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads, value: () => 'one', watch: true })],
    })
    await turn.run()
    turn.daemon.seqs.set(watchId, 1)
    turn.changed(watchId)
    await turn.settled()
    await turn.closed()
    await turn.closed()

    expect(loads).toEqual(['tools', 'tools'])
    expect(turn.events).toHaveLength(1)
  })

  it('settles unchanged values after a daemon restart', async () => {
    const loads: string[] = []
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads, value: () => 'one', watch: true })],
    })
    await turn.run()
    turn.daemon.setInstance('instance-2')
    turn.reconnect(true)
    await turn.settled()
    await turn.closed()
    await turn.closed()

    expect(loads).toEqual(['tools', 'tools'])
    expect(turn.events).toHaveLength(1)
  })

  it('loads once after host memory is lost and then settles', async () => {
    const resource = stringResource({ name: 'tools', loads: [], value: () => 'one', watch: true })
    const previous = rig({ resources: [resource] })
    await previous.run()
    previous.daemon.seqs.set(watchId, 1)
    previous.changed(watchId)
    await previous.settled()
    previous.sync.stop()

    const loads: string[] = []
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads, value: () => 'one', watch: true })],
      daemon: previous.daemon,
    })
    turn.events.push(...structuredClone(previous.events))
    await turn.run()
    await turn.closed()
    await turn.closed()

    expect(loads).toEqual(['tools'])
    expect(turn.events).toHaveLength(1)
  })

  it('adopts a shared unchanged reload under its settled watch fingerprint', async () => {
    const main = rig({
      resources: [stringResource({ name: 'tools', loads: [], value: () => 'one', watch: true })],
    })
    main.ctx.runtime = new PodRuntimeScope(main.ctx)
    await main.run()
    main.daemon.seqs.set(watchId, 1)
    main.changed(watchId)
    await main.settled()

    const loads: string[] = []
    const child = rig({
      resources: [stringResource({ name: 'tools', loads, value: () => 'one', watch: true })],
      daemon: main.daemon,
      shared: () => main.events,
    })
    child.ctx.runtime = main.ctx.runtime
    child.start()
    await child.settled()
    await child.closed()
    await child.closed()

    expect(loads).toEqual([])
    expect(child.events).toHaveLength(1)
    expect(main.events).toHaveLength(1)
  })

  it('appends an identical value when the cloud version changed and settles the next turn', async () => {
    const loads: string[] = []
    const turn = rig({
      resources: [
        stringResource({
          name: 'tools',
          loads,
          value: () => 'one',
          cloud: [ECloudSetting.McpServers],
        }),
      ],
    })
    await turn.run()
    turn.daemon.setVersions(versionsAt('v2'))
    await turn.run()
    await turn.run()

    expect(snapshotsOf(turn)).toHaveLength(2)
    expect(loads).toEqual(['tools', 'tools'])
  })

  it('appends an identical value when the project directory changed', async () => {
    const turn = rig({
      resources: [stringResource({ name: 'tools', loads: [], value: () => 'one' })],
    })
    await turn.run()
    await turn.run('/elsewhere')
    await turn.closed()
    await turn.closed()

    expect(snapshotsOf(turn)).toHaveLength(2)
  })

  it('allows independent announcements without another resource snapshot', async () => {
    let announcement = 'first'
    const turn = rig({
      resources: [
        stringResource({
          name: 'tools',
          loads: [],
          value: () => 'one',
          stale: () => true,
          announce: () => [{ type: 'probe-observed', label: announcement }],
        }),
      ],
    })
    await turn.run()
    announcement = 'resolved'
    await turn.closed()

    expect(snapshotsOf(turn)).toHaveLength(1)
    expect(
      turn.events.filter((event) => event.type === 'probe-observed').map((event) => event.label),
    ).toEqual(['first', 'resolved'])
  })

  it('deduplicates background snapshots without an empty append', async () => {
    const appended: number[] = []
    const turn = rig({
      beforeAppend: async (drafts) => {
        appended.push(drafts.length)
      },
      resources: [
        stringResource({
          name: 'tools',
          loads: [],
          value: () => 'one',
          stale: () => true,
          background: true,
        }),
      ],
    })
    await turn.run()
    await turn.closed()

    expect(turn.events).toHaveLength(1)
    expect(appended).toEqual([1])
  })

  it('does not append an identical value adopted under a newer watch fingerprint', async () => {
    const resource = stringResource({ name: 'tools', loads: [], value: () => 'one' })
    const turn = rig({ resources: [resource] })
    await turn.run()

    expect(
      await turn.sync.adoptOf({
        resource,
        fingerprint: `instance-2:3::${DIRECTORY}`,
        value: 'one',
      }),
    ).toBe(true)
    expect(turn.events).toHaveLength(1)
  })
})
