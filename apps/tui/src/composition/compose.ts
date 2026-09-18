import { hostname } from 'node:os'

import { OnThreadOpenHook } from '@dltech/atlas-core'
import {
  atlasDirectory,
  composeHarness,
  portToken,
  type HarnessApp,
  type SandboxControl,
  type SessionTitler,
  type SettingsBinding,
} from '@dltech/atlas-harness'

import { clientVersionHeader } from '../build/info'
import { assemblePlugins } from '../plugins/assemble'
import { PullRequestPort } from '../plugins/github/pure'
import type { ContributedProjection } from '../plugins/projection'
import type { ContributedSurface } from '../plugins/surface'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { tldrFeed } from '../ui/tldr-feed-store'

import type { QueuedSettled } from './commands'
import type { AtlasConfig } from './config'
import { noticePortBinding } from './notice-binding'
import { createWarpReporter, WarpThreadOpenHook } from './warp-reporter'

export type { SandboxControl, SessionTitler }

type TuiSurface = {
  pluginProjections: readonly ContributedProjection[]
  pluginSurfaces: readonly ContributedSurface[]
  pullRequests: PullRequestPort | null
}

export type AtlasApp = Omit<HarnessApp<TuiSurface, QueuedSettled>, 'surface'> &
  TuiSurface & {
    config: AtlasConfig
    command: string
  }

export async function composeAtlas(args: {
  config: AtlasConfig
  command: string
  env: Record<string, string | undefined>
  settings: SettingsBinding
}): Promise<AtlasApp> {
  const app = await composeHarness<TuiSurface, QueuedSettled>({
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

        const plugins = await assemblePlugins({
          container,
          cwd: args.config.cwd,
          atlasHome: atlasDirectory(),
        })
        for (const refusal of [...plugins.refused, ...plugins.unreadable]) {
          notify({
            key: `plugin:${refusal.id ?? '?'}`,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: `plugin refused: ${refusal.id ?? '?'} — ${'reason' in refusal ? refusal.reason : refusal.detail}`,
          })
        }

        /**
         * The github plugin is a native but still a plugin: a repo plugin may shadow it, and then
         * nobody bound the port. The conversation lister's pills are the only consumer, and they
         * are decoration worth dropping rather than a wiring error worth throwing.
         */
        const pullRequests = ((): PullRequestPort | null => {
          try {
            return container.resolve(portToken(PullRequestPort))
          } catch {
            return null
          }
        })()

        return {
          pluginProjections: plugins.projections,
          pluginSurfaces: plugins.surfaces,
          pullRequests,
        }
      },
    },
  })

  const { surface, ...harness } = app
  return {
    ...harness,
    config: args.config,
    command: args.command,
    pluginProjections: surface.pluginProjections,
    pluginSurfaces: surface.pluginSurfaces,
    pullRequests: surface.pullRequests,
  }
}
