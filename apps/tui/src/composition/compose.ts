import { hostname } from 'node:os'

import { OnThreadOpenHook } from '@dltech/atlas-core'
import {
  composeHarness,
  createUrlOpener,
  portToken,
  GithubUiBridgePort,
  PullRequestPort,
  type ContributedProjection,
  type HarnessApp,
  type SandboxControl,
  type SessionTitler,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../build/info'
import { pullRequestSurface } from '../plugins/github/surface'
import type { ContributedSurface, PluginSurface } from '../plugins/surface'
import { tldrFeed } from '../ui/tldr-feed-store'

import type { QueuedSettled } from './commands'
import type { AtlasConfig } from './config'
import { noticePortBinding } from './notice-binding'
import { createWarpReporter, WarpThreadOpenHook } from './warp-reporter'

export type { SandboxControl, SessionTitler }

type TuiSurface = {
  pullRequests: PullRequestPort | null
  githubSurface: ContributedSurface | null
}

export type AtlasApp = Omit<
  HarnessApp<TuiSurface, QueuedSettled, PluginSurface>,
  'surface' | 'pluginProjections' | 'pluginSurfaces'
> & {
  pluginProjections: readonly ContributedProjection[]
  pluginSurfaces: readonly ContributedSurface[]
  pullRequests: PullRequestPort | null
  config: AtlasConfig
  command: string
}

/**
 * The github plugin's live poller renders behind a React surface, and only the TUI ever renders
 * one — so this is where the same `service`/`facts`/`links` the plugin built are reached back out
 * and turned into the footer chip and sidebar section, exactly as `composeHarness` handed every
 * other plugin's UI-agnostic contribution straight through.
 */
const resolveGithubSurface = (args: { bridge: GithubUiBridgePort }): ContributedSurface =>
  pullRequestSurface({
    service: args.bridge.service,
    facts: args.bridge.facts,
    links: args.bridge.links,
    cloudCheckout: args.bridge.cloudCheckout,
    openUrl: createUrlOpener(),
  })

export async function composeAtlas(args: {
  config: AtlasConfig
  command: string
  env: Record<string, string | undefined>
  settings: SettingsBinding
}): Promise<AtlasApp> {
  const app = await composeHarness<TuiSurface, QueuedSettled, PluginSurface>({
    launch: {
      cwd: args.config.cwd,
      command: args.command,
      model: args.config.model,
      executionLocation: args.config.executionLocation,
    },
    env: args.env,
    settings: args.settings,
    clientVersion: clientVersionHeader(),
    surface: {
      notice: noticePortBinding(),
      tldrFeed,
      bind: async ({ container }) => {
        const warp = createWarpReporter({
          env: args.env,
          write: (sequence) => process.stdout.write(sequence),
          host: args.env.HOSTNAME ?? hostname(),
        })
        if (warp !== null) {
          container.register(portToken(OnThreadOpenHook), {
            useValue: new WarpThreadOpenHook(warp),
          })
        }

        /**
         * The github plugin is a native but still a plugin: a repo plugin may shadow it, and then
         * nobody bound the ports. The conversation lister's pills and the footer chip are the only
         * consumers, and they are decoration worth dropping rather than a wiring error worth
         * throwing.
         */
        const pullRequests = ((): PullRequestPort | null => {
          try {
            return container.resolve(portToken(PullRequestPort))
          } catch {
            return null
          }
        })()

        const githubSurface = ((): ContributedSurface | null => {
          try {
            return resolveGithubSurface({ bridge: container.resolve(portToken(GithubUiBridgePort)) })
          } catch {
            return null
          }
        })()

        return { pullRequests, githubSurface }
      },
    },
  })

  const { surface, pluginSurfaces, pluginProjections, ...harness } = app

  return {
    ...harness,
    config: args.config,
    command: args.command,
    pluginProjections,
    pluginSurfaces:
      surface.githubSurface === null ? pluginSurfaces : [...pluginSurfaces, surface.githubSurface],
    pullRequests: surface.pullRequests,
  }
}
