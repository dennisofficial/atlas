import { refKey, type ModelChoice } from '@dltech/atlas-core'
import type { Tx } from '@dltech/atlas-db'
import {
  sessionModelOf,
  settingsWithProjectOverUser,
  type SessionModelAsk,
  type AccountRowLike,
} from '@dltech/atlas-models'

import type { SessionModelRow } from '../port'

const ACCOUNT_FIELDS = [
  'id',
  'provider',
  'kind',
  'origin',
  'label',
  'status',
  'email',
  'subscription',
  'importedFrom',
  'createdAt',
  'updatedAt',
] as const

export const resolveSessionModelIn = async (params: {
  tx: Tx
  userId: string
  projectId: string | null
  ask: SessionModelAsk
  current?: ModelChoice | undefined
}): Promise<SessionModelRow> => {
  const { tx } = params
  const userRows = await tx.orm.public.UserSetting.where({ userId: params.userId })
    .select('key', 'value')
    .all()
  const projectRows =
    params.projectId === null
      ? []
      : await tx.orm.public.ProjectSetting.where({ projectId: params.projectId })
          .select('key', 'value')
          .all()
  const accountRows = await tx.orm.public.AgentAccount.where({ userId: params.userId })
    .select(...ACCOUNT_FIELDS)
    .all()
  const activeRows = await tx.orm.public.ActiveAccount.where({ userId: params.userId })
    .select('provider', 'accountId')
    .all()
  const settings = settingsWithProjectOverUser({
    user: new Map(userRows.map((row) => [row.key, row.value])),
    project: new Map(projectRows.map((row) => [row.key, row.value])),
  })
  const accounts: readonly AccountRowLike[] = accountRows
  const choice = sessionModelOf({
    settings,
    accounts,
    activeAccounts: activeRows,
    ask: params.ask,
    ...(params.current === undefined ? {} : { current: params.current }),
  })
  return { modelRef: refKey(choice.ref), modelEffort: choice.effort, modelFast: choice.fast }
}
