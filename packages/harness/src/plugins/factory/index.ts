import type { ToolDefinition } from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../../container/injection'
import { ClientVersionToken } from '../../container/tokens'
import { EServeEnv } from '../../serve/serve-config'
import { CONTRIBUTES_NOTHING, NativePlugin, type PluginContribution } from '../plugin'

import { FactoryClient } from './client'
import { orchestratorFactoryTools, stationFactoryTools } from './factory-tools'
import { githubTools } from './github-tools'
import { linearTools } from './linear-tools'

export enum EFactoryRole {
  Orchestrator = 'orchestrator',
  Station = 'station',
}

enum EFactoryEnv {
  Role = 'ATLAS_FACTORY_ROLE',
}

const roleOf = (value: string | undefined): EFactoryRole | null => {
  if (value === EFactoryRole.Orchestrator) return EFactoryRole.Orchestrator
  if (value === EFactoryRole.Station) return EFactoryRole.Station
  return null
}

/**
 * Factory serve sessions (orchestrator and station sandboxes) get first-class tools against the
 * control plane instead of curl recipes. Every other session - TUI included - has no
 * ATLAS_FACTORY_ROLE, and this plugin contributes nothing there; it still loads everywhere so TUI
 * and serve keep the identical plugin set.
 */
export default class FactoryPlugin extends NativePlugin {
  readonly id = 'factory'

  constructor(
    private readonly args: {
      role: EFactoryRole | null
      url: string | null
      token: string | null
      clientVersion: string
      fetchFn?: typeof fetch | undefined
    },
  ) {
    super()
  }

  contribute(): PluginContribution {
    const { role, url, token } = this.args
    if (role === null || url === null || token === null) return CONTRIBUTES_NOTHING

    const client = new FactoryClient({
      url,
      token,
      clientVersion: this.args.clientVersion,
      ...(this.args.fetchFn === undefined ? {} : { fetchFn: this.args.fetchFn }),
    })

    const tools: readonly ToolDefinition[] =
      role === EFactoryRole.Orchestrator
        ? [
            ...orchestratorFactoryTools({ client }),
            ...githubTools({ client }),
            ...linearTools({ client }),
          ]
        : stationFactoryTools({ client })

    return { tools }
  }
}

export function registerPlugin({ container }: { container: DependencyContainer }): void {
  container.register(portToken(NativePlugin), {
    useFactory: (resolver) =>
      new FactoryPlugin({
        role: roleOf(process.env[EFactoryEnv.Role]),
        url: process.env[EServeEnv.CloudUrl] ?? null,
        token: process.env[EServeEnv.Token] ?? null,
        clientVersion: resolver.resolve(ClientVersionToken),
      }),
  })
}
