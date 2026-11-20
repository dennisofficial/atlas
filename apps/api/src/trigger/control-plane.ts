import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { eventSchemaOf } from '@dltech/atlas-plugin-sdk'

import { composedPlugins, registeredPlugins } from '../api/platform/control/registered-plugins'

export const triggerEventSchema = eventSchemaOf(registeredPlugins)

export const triggerControlPlane = (): ControlPlane =>
  new ControlPlane({
    store: new PostgresControlStore(db),
    eventSchema: triggerEventSchema,
    pluginViews: composedPlugins.views,
  })
