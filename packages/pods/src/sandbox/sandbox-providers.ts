import type { Db } from '@dltech/atlas-db'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { PodsEnv } from '../env'
import { DAEMON_BUNDLE_ROUTE } from '../http/daemon-bundle-route'
import { agent37InstanceIdsOf } from './agent37/agent37-instance-store'
import { Agent37SandboxProvider } from './agent37/agent37-sandbox-provider'
import { sandboxRegistryOf, type SandboxProviderRegistry } from './provider-registry'
import type { SandboxProvider } from './sandbox-provider'
import { VercelSandboxProvider } from './vercel-sandbox-provider'

export type SandboxProvidersEnv = Pick<
  PodsEnv,
  'sandboxImage' | 'daemonBundlePath' | 'daemonSecret' | 'apiOrigin' | 'agent37' | 'publicUrl'
>

const sandboxLog = (line: string): void => {
  console.log(JSON.stringify({ level: 'info', source: 'sandbox', message: line }))
}

export const sandboxProvidersOf = (args: {
  env: SandboxProvidersEnv
  db: Db
}): SandboxProviderRegistry => {
  const adapters = new Map<ESandboxProvider, SandboxProvider>([
    [
      ESandboxProvider.Vercel,
      new VercelSandboxProvider({
        image: args.env.sandboxImage,
        daemonBundle: { path: args.env.daemonBundlePath },
        daemonSecret: args.env.daemonSecret,
        cloudUrl: args.env.apiOrigin,
        log: sandboxLog,
      }),
    ],
  ])
  const agent37 = args.env.agent37
  if (agent37 !== null) {
    adapters.set(
      ESandboxProvider.Agent37,
      new Agent37SandboxProvider({
        env: agent37,
        daemonBundle: { path: args.env.daemonBundlePath },
        daemonBundleUrl: `${args.env.publicUrl.replace(/\/$/, '')}/${DAEMON_BUNDLE_ROUTE}`,
        daemonSecret: args.env.daemonSecret,
        instances: agent37InstanceIdsOf(args.db),
        log: sandboxLog,
      }),
    )
  }
  return sandboxRegistryOf(adapters)
}
