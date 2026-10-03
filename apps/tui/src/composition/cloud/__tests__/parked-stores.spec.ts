import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'

import { fakeEventLog, fakeLedger, fakeThreadStore } from '../../__tests__/fake-backend'
import { parkedStoresOf } from '../parked-stores'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

const stores = async () => {
  const local = { log: fakeEventLog(), threads: fakeThreadStore(), ledger: fakeLedger() }
  const remote = { log: fakeEventLog(), threads: fakeThreadStore(), ledger: fakeLedger() }
  await local.log.append({ threadId: CLOUD_THREAD, runId: toRunId('local'), drafts: [said('written here')] })
  await remote.log.append({ threadId: CLOUD_THREAD, runId: toRunId('remote'), drafts: [said('written there')] })
  return { local, remote }
}

const textsOf = (events: readonly { type: string }[]): unknown[] =>
  events.map((event) => ('text' in event ? event.text : undefined))

describe('the stores of a session that mounted before its channel dialled', () => {
  it('reads the local transcript while the channel is parked, then the sandbox once it first opens', async () => {
    const { local, remote } = await stores()
    const channel = fakeCloudChannel({ connection: { state: EChannelConnection.Parked, detail: null } })
    const held = parkedStoresOf({ channel, local, remote })

    expect(textsOf(await held.log.read({ threadId: CLOUD_THREAD }))).toEqual(['written here'])

    channel.moveTo({ state: EChannelConnection.Open, detail: null })

    expect(textsOf(await held.log.read({ threadId: CLOUD_THREAD }))).toEqual(['written there'])
  })

  it('stays on the sandbox through a later socket gap', async () => {
    const { local, remote } = await stores()
    const channel = fakeCloudChannel({ connection: { state: EChannelConnection.Open, detail: null } })
    const held = parkedStoresOf({ channel, local, remote })
    await held.log.head({ threadId: CLOUD_THREAD })

    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })

    expect(textsOf(await held.log.read({ threadId: CLOUD_THREAD }))).toEqual(['written there'])
  })

  it('never writes locally, so a send through the log still reaches the sandbox owner', async () => {
    const { local, remote } = await stores()
    const channel = fakeCloudChannel({ connection: { state: EChannelConnection.Parked, detail: null } })
    const held = parkedStoresOf({ channel, local, remote })

    await held.log.append({ threadId: CLOUD_THREAD, runId: toRunId('x'), drafts: [said('appended')] })

    expect(textsOf(await local.log.read({ threadId: CLOUD_THREAD }))).toEqual(['written here'])
    expect(textsOf(await remote.log.read({ threadId: CLOUD_THREAD }))).toEqual(['written there', 'appended'])
  })

  it('listens for renames on the sandbox side only', async () => {
    const { local, remote } = await stores()
    const channel = fakeCloudChannel({ connection: { state: EChannelConnection.Parked, detail: null } })
    const held = parkedStoresOf({ channel, local, remote })
    const heard: string[] = []
    held.threads.onRename(({ title }) => heard.push(title))

    await local.threads.create({ id: CLOUD_THREAD, workspace: '/work', repo: null })
    await local.threads.rename({ threadId: CLOUD_THREAD, title: 'local title' })
    await remote.threads.create({ id: CLOUD_THREAD, workspace: '/work', repo: null })
    await remote.threads.rename({ threadId: CLOUD_THREAD, title: 'remote title' })

    expect(heard).toEqual(['remote title'])
  })
})
