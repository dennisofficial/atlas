import { randomUUID } from 'node:crypto'

import {
  type DaemonSession,
  type DaemonSpawnedHandle,
  type InMemoryDaemon,
  createInMemoryDaemon,
  describeDaemonConformance,
  inMemoryDaemonToken,
} from '../testing'

const SANDBOX = 'atlas-v2-conformance'
const SECRET = 'conformance-secret'

class FakeHandle implements DaemonSpawnedHandle {
  readonly token = inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX })
  readonly daemon: InMemoryDaemon

  constructor() {
    this.daemon = createInMemoryDaemon({
      bootId: randomUUID(),
      version: 'fake-0.1.0',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
  }

  pid(): number {
    return process.pid
  }

  spawnCount(): Promise<number> {
    return Promise.resolve(this.daemon.spawnCount())
  }

  bootId(): Promise<string> {
    return Promise.resolve(this.daemon.bootId)
  }

  writableCgroups(): Promise<boolean> {
    return Promise.resolve(false)
  }

  kill(): Promise<void> {
    return Promise.resolve()
  }
}

describeDaemonConformance({
  name: 'in-memory',
  setup: () => Promise.resolve(new FakeHandle()),
  connect: (handle) => {
    const fake = handle as FakeHandle
    return Promise.resolve(fake.daemon.connect() as DaemonSession)
  },
  teardown: () => Promise.resolve(),
})
