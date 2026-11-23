import { ControlPlane, type ControlStorePort } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import type { Db } from '@dltech/atlas-db'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'

import { composedPlugins, registeredPlugins } from './registered-plugins'

export const controlEventSchema = eventSchemaOf(registeredPlugins)

export const composedControlPlaneOver = (args: { store: ControlStorePort }): ControlPlane =>
  new ControlPlane({
    store: args.store,
    eventSchema: controlEventSchema,
    pluginViews: composedPlugins.views,
  })

export const jobsControlPlaneOf = (args: { db: Db }): ControlPlane =>
  composedControlPlaneOver({ store: new PostgresControlStore(args.db) })
