import { composePlugins, type Plugin } from '@dltech/atlas-plugin-sdk'

export const registeredPlugins: readonly Plugin[] = []

export const composedPlugins = composePlugins(registeredPlugins)
