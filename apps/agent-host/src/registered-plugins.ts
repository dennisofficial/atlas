import { composePlugins, definePlugin, type Plugin } from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'
import { githubPod } from '@dltech/atlas-plugin-github/pod'

export const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: githubPod,
    control: githubControl,
    client: { hooks: [] },
    transport: 'stream',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
