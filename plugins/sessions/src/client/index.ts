import { pluginViewOf } from '@dltech/atlas-client/stream'

import { PLAN_VIEW, planViewSchema, type PlanTask } from '../core'

export {
  nestPeers,
  type PeerRow,
  type PeerTreeNode,
} from '@dltech/atlas-client/stream'

export const planOfView = (views: Readonly<Record<string, unknown>>): readonly PlanTask[] =>
  pluginViewOf({ views, name: PLAN_VIEW, schema: planViewSchema })?.tasks ?? []
