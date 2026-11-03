import {
  createInMemoryDaemon,
  describeDaemonConformance,
  inMemoryDaemonToken,
  type DaemonHandle,
} from '../testing'

const SANDBOX = 'atlas-v2-conformance'
const SECRET = 'conformance-secret'

describeDaemonConformance({
  name: 'in-memory',
  start: async (): Promise<DaemonHandle> => {
    const daemon = await createInMemoryDaemon({
      version: 'fake-0.1.0',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    return {
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      foreignToken: ({ sandboxName, secret } = {}) =>
        inMemoryDaemonToken({
          secret: secret ?? SECRET,
          sandboxName: sandboxName ?? SANDBOX,
        }),
      bootId: () => daemon.bootId(),
      connect: async () => daemon.connect(),
      restart: () => daemon.restart(),
      stop: () => daemon.stop(),
      realProcesses: false,
      processAlive: () => false,
    }
  },
})
