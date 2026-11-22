import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import type { Db } from '@dltech/atlas-db'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'

import { composedPlugins, registeredPlugins } from './registered-plugins'

export const controlEventSchema = eventSchemaOf(registeredPlugins)

export const jobsControlPlaneOf = (args: { db: Db }): ControlPlane =>
  new ControlPlane({
    store: new PostgresControlStore(args.db),
    eventSchema: controlEventSchema,
    pluginViews: composedPlugins.views,
  })
