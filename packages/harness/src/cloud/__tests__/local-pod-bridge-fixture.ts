import {
  createLocalPodBridge,
  type LocalPodBridgeOptions,
  type PodBridgeDriver,
} from '../local-pod-bridge'
import type { PodProvisionArgs, RunnerPodHandle } from '../runner-driver'

export type WriteRecord = { name: string; path: string; content: Uint8Array | string }

export const POD_CONFIG = { cloudUrl: 'http://cloud.test', home: '/home/test/.atlas' }

export const fakePodDriver = (args: { created: boolean }) => {
  const events: string[] = []
  const writes: WriteRecord[] = []
  const created: PodProvisionArgs<RunnerPodHandle>[] = []
  const destroyed: Parameters<PodBridgeDriver['destroy']>[0][] = []
  const resized: Parameters<PodBridgeDriver['updateResources']>[0][] = []
  const driver: PodBridgeDriver = {
    createOrResume: async (provision) => {
      created.push(provision)
      events.push('create')
      if (args.created) await provision.putContextOnFreshBoot?.({ name: provision.name })
      events.push('launch')
      return {
        url: 'http://127.0.0.1:20111',
        state: 'running',
        created: args.created,
        token: provision.token ?? '',
      }
    },
    inspect: async () => undefined,
    writeBootstrapFile: async (write) => {
      events.push(`write:${write.path}`)
      writes.push(write)
    },
    readResources: async () => ({ vcpus: 2, memoryMb: 4096 }),
    updateResources: async (resize) => {
      resized.push(resize)
    },
    destroy: async (destroy) => {
      destroyed.push(destroy)
    },
  }
  return { driver, events, writes, created, destroyed, resized }
}

export const podBridgeWith = (args: {
  driver: PodBridgeDriver
  registered?: Array<{ threadId: string; token: string }>
  events?: string[]
  overrides?: Partial<LocalPodBridgeOptions>
}) =>
  createLocalPodBridge({
    pod: () => POD_CONFIG,
    attachmentToken: ({ threadId }) => `serve-token-${threadId}`,
    registerPodLease: async (lease) => {
      args.events?.push('register')
      args.registered?.push(lease)
    },
    driverWith: () => args.driver,
    sessionMirror: false,
    ...args.overrides,
  })
