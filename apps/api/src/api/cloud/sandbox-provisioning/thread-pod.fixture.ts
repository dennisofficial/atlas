import { vi } from 'bun:test'
import { seedSandboxRow } from '../../../../test/session-seed'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { PodLaunchService } from './pod-launch.service'
import { cipher, podLaunchWith } from './sandbox-provisioning.fixture'
import { ThreadPodService } from './thread-pod.service'

export const SERVE_TOKEN = 'raw-serve-token-never-leaves-the-api'
export const SERVE_URL = 'https://serve.example.test'

export const unreachableVercel = (): VercelSandboxClient =>
  ({
    inspect: vi.fn(async () => {
      throw new Error('vercel is not reachable in this spec')
    }),
    readResources: vi.fn(async () => {
      throw new Error('vercel is not reachable in this spec')
    }),
  }) as unknown as VercelSandboxClient

export const podServiceOver = (
  endpoints: SandboxEndpointService,
  vercel: VercelSandboxClient = unreachableVercel(),
  launch: PodLaunchService = podLaunchWith().pod,
  signals: ThreadSignalsService = inertSignals(),
): ThreadPodService => new ThreadPodService(endpoints, vercel, launch, signals)

export const realEndpoints = (): SandboxEndpointService =>
  new SandboxEndpointService(unreachableVercel(), cipher)

export const seedServingPod = (args: { threadId: string; userId: string; state?: string }) =>
  seedSandboxRow({
    threadId: args.threadId,
    userId: args.userId,
    state: args.state ?? 'running',
    serveUrl: SERVE_URL,
    sealedToken: cipher.encrypt(SERVE_TOKEN),
  })
