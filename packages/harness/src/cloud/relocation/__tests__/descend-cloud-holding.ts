import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { CLOUD_THREAD, fakeBridge, type FakeBridge, type FakeCloudChannel } from './fixture'

export const cloudHolding = (args: {
  archive: SessionArchiveDescriptor | null
}): { bridge: FakeBridge; channel: FakeCloudChannel } => {
  const bridge = fakeBridge({ archive: args.archive })
  const { channel } = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' })
  return { bridge, channel }
}
