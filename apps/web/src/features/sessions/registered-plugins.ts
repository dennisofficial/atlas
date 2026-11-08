import { eventSchemaOf, type Plugin } from '@dltech/atlas-plugin-sdk'

const registeredPlugins: readonly Plugin[] = []

export const sessionEventSchema = eventSchemaOf(registeredPlugins)
