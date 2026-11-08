import { composePlugins, definePlugin, EMPTY_POD, type Plugin } from '@dltech/atlas-plugin-sdk'
import { githubControl } from '@dltech/atlas-plugin-github/control'
import { githubCoreSlots } from '@dltech/atlas-plugin-github/core'

export const registeredPlugins: readonly Plugin[] = [
  definePlugin({
    name: 'github',
    ...githubCoreSlots,
    pod: EMPTY_POD,
    control: githubControl,
    client: { hooks: [] },
    transport: 'stream',
  }),
]

export const composedPlugins = composePlugins(registeredPlugins)
