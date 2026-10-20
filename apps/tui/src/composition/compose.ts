import { hostname } from 'node:os'

import { OnThreadOpenHook } from '@dltech/atlas-core'
import {
  composeHarness,
  createUrlOpener,
  portToken,
  registeredPortToken,
  sharedPortBindings,
  GithubUiBridgePort,
  MutableAppInstallSink,
  AppInstallRecommendationSink,
  MutablePrEventSink,
  PrEventFrameSink,
  PullRequestPort,
  cloudClientFor,
  CloudSessionStoreToken,
  type ContributedProjection,
  type HarnessApp,
  type RewindMachineryPort,
  type RotationPort,
  type SessionTitler,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../build/info'
import type { CrewPullRequests } from '../plugins/github/crew-pull-request'
import { pullRequestSurface } from '../plugins/github/surface'
import type { ContributedSurface, PluginSurface } from '../plugins/surface'
import { tldrFeed } from '../ui/tldr-feed-store'

import { RemoteAgentRegistry } from './cloud/remote-agents'
import { RemoteRotation } from './cloud/remote-rotation'
import { RemoteServiceRegistry } from './cloud/remote-services'
import { RemoteShellRegistry } from './cloud/remote-shells'
import type { QueuedSettled } from './commands'
import type { AtlasConfig } from './config'
import { noticePortBinding } from './notice-binding'
import { createWarpReporter, WarpThreadOpenHook } from './warp-reporter'

export type { SessionTitler }

type TuiSurface = {
  pullRequests: PullRequestPort | null
  githubSurface: ContributedSurface | null
  crewPullRequests: CrewPullRequests | null
  prEventSink: MutablePrEventSink | null
}

export type AtlasApp = Omit<
  HarnessApp<TuiSurface, QueuedSettled, PluginSurface>,
  'surface' | 'pluginProjections' | 'pluginSurfaces'
> & {
  pluginProjections: readonly ContributedProjection[]
  pluginSurfaces: readonly ContributedSurface[]
  pullRequests: PullRequestPort | null
  /** Where each teammate thread stands and what its pull request reads; null when the github plugin is shadowed. */
  crewPullRequests?: CrewPullRequests | null
  /** The read tap on the pull-request event stream; the parked-cloud forwarder attaches here. */
  prEventSink: MutablePrEventSink | null
  /** Absent for a local session, where rewind cleans up through the local registries. */
  rewindMachinery?: RewindMachineryPort | undefined
  rotation?: RotationPort | undefined
  config: AtlasConfig
  command: string
}

/**
 * The github plugin's live poller renders behind a React surface, and only the TUI ever renders
 * one — so this is where the same `service`/`facts`/`links` the plugin built are reached back out
 * and turned into the footer chip and sidebar section, exactly as `composeHarness` handed every
 * other plugin's UI-agnostic contribution straight through.
 */
const resolveGithubSurface = (args: {
  bridge: GithubUiBridgePort
  appInstallSink: MutableAppInstallSink | null
  recordDismissal: ((args: { repo: string }) => void) | undefined
}): ContributedSurface =>
  pullRequestSurface({
    service: args.bridge.service,
    facts: args.bridge.facts,
    links: args.bridge.links,
    cloudCheckout: args.bridge.cloudCheckout,
    badges: args.bridge.badges,
    openUrl: createUrlOpener(),
    appInstall:
      args.appInstallSink === null
        ? null
        : {
            subscribe: (listener) => {
              args.appInstallSink?.set((recommendation) => listener(recommendation))
              return () => args.appInstallSink?.set(null)
            },
          },
    ...(args.recordDismissal === undefined
      ? {}
      : { recordAppInstallDismissal: args.recordDismissal }),
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
      model: args.config.model === undefined ? undefined : { ref: args.config.model },
    },
    env: args.env,
    settings: args.settings,
    clientVersion: clientVersionHeader(),
    ports: {
      ...sharedPortBindings,
      RotationPort: { runtime: 'shared', transport: RemoteRotation },
      ShellRegistryPort: { runtime: 'shared', transport: RemoteShellRegistry },
      AgentRegistryPort: { runtime: 'shared', transport: RemoteAgentRegistry },
      ServiceRegistryPort: { runtime: 'shared', transport: RemoteServiceRegistry },
    },
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
            return container.resolve(registeredPortToken(PullRequestPort))
          } catch {
            return null
          }
        })()

        const appInstallSink = ((): MutableAppInstallSink | null => {
          try {
            const sink = container.resolve(registeredPortToken(AppInstallRecommendationSink))
            return sink instanceof MutableAppInstallSink ? sink : null
          } catch {
            return null
          }
        })()

        const recordDismissal = ((): ((args: { repo: string }) => void) | undefined => {
          const store = ((): { read(): { url: string; token: string; email: string | null } | null } | null => {
            try {
              return container.resolve(CloudSessionStoreToken)
            } catch {
              return null
            }
          })()
          if (store === null) return undefined
          return ({ repo }) => {
            const session = store.read()
            if (session === null) return
            void cloudClientFor({ session })
              .dismissGithubAppInstallNotice({ repoFullName: repo })
              .catch(() => undefined)
          }
        })()

        const githubSurface = ((): ContributedSurface | null => {
          try {
            return resolveGithubSurface({
              bridge: container.resolve(registeredPortToken(GithubUiBridgePort)),
              appInstallSink,
              recordDismissal,
            })
          } catch {
            return null
          }
        })()

        const crewPullRequests = ((): CrewPullRequests | null => {
          try {
            const bridge = container.resolve(registeredPortToken(GithubUiBridgePort))
            return { service: bridge.service, checkoutFor: bridge.checkoutFor }
          } catch {
            return null
          }
        })()

        const prEventSink = ((): MutablePrEventSink | null => {
          try {
            const sink = container.resolve(registeredPortToken(PrEventFrameSink))
            return sink instanceof MutablePrEventSink ? sink : null
          } catch {
            return null
          }
        })()

        return { pullRequests, githubSurface, crewPullRequests, prEventSink }
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
    crewPullRequests: surface.crewPullRequests,
    prEventSink: surface.prEventSink,
  }
}
