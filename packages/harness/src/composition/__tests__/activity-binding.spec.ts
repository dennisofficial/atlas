import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { SessionActivityPort } from '../../activity/port'
import { RuntimeSessionActivity } from '../../activity/runtime-session-activity'
import { createDeltaChannel } from '../../channel/delta-channel'
import { createHarnessContainer } from '../../container/create-harness-container'
import { WorkspaceRoot } from '../../container/tokens'
import { ThreadStorePort } from '../../store/thread-store'
import { registeredPortToken } from '../../container/injection'
import { bindActivity } from '../activity-binding'
import { sharedPortBindings } from '../port-bindings'
import { RemoteSessionActivity } from '../../activity/remote-session-activity'

describe('registered activity composition', () => {
  it('resolves one shared runtime reader and declares its detached adapter', async () => {
    const container = createHarnessContainer()
    container.register(WorkspaceRoot, { useValue: '/work' })
    await container
      .resolve(registeredPortToken(ThreadStorePort))
      .create({ id: toThreadId('activity-root') })
    const activity = bindActivity({ container, channel: createDeltaChannel() })
    expect(container.resolve(registeredPortToken(SessionActivityPort))).toBe(activity)
    expect(activity).toBeInstanceOf(RuntimeSessionActivity)
    expect(sharedPortBindings.SessionActivityPort).toEqual({
      runtime: 'shared',
      transport: RemoteSessionActivity,
    })
    expect(await activity.read({ threadId: toThreadId('activity-root') })).toMatchObject({
      turnEpoch: 0,
      working: false,
      awaiting: null,
      observedOutcome: null,
    })
    activity.close()
    await container.dispose()
  })
})
