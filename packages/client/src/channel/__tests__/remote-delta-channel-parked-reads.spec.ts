import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '../channel-wire'
import { EConnectionView } from '../connection-view'
import { RemoteRequestLost } from '../remote-channel-upstream'
import { harness } from './remote-channel-fixture'

const parkedWithWake = () => {
  let wakes = 0
  const test = harness({
    unattached: true,
    readsWake: false,
    wakeSandbox: () => {
      wakes += 1
      return new Promise(() => undefined)
    },
  })
  return { test, wakes: () => wakes }
}

describe('a parked channel that keeps the pod asleep for reads', () => {
  it('refuses a read without waking the pod', async () => {
    for (const op of [
      EClientRequest.ListRoster,
      EClientRequest.ListSubscriptions,
      EClientRequest.ListPrStates,
      EClientRequest.ReadEvents,
      EClientRequest.ReadThread,
      EClientRequest.ListContextFiles,
    ]) {
      const { test, wakes } = parkedWithWake()

      await expect(test.channel.request({ op, params: {} })).rejects.toBeInstanceOf(
        RemoteRequestLost,
      )

      expect(wakes()).toBe(0)
      expect(test.channel.connection().state).toBe(EConnectionView.Parked)
    }
  })

  it('still wakes the pod for an action', () => {
    for (const op of [
      EClientRequest.Rewind,
      EClientRequest.RenameThread,
      EClientRequest.SetThreadModel,
      EClientRequest.TakeBackPending,
    ]) {
      const { test, wakes } = parkedWithWake()

      void test.channel.request({ op, params: {} }).catch(() => undefined)

      expect(wakes()).toBe(1)
    }
  })
})
