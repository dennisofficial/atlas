import { db } from '@dltech/atlas-db'
import { seedThread } from '@dltech/atlas-db/testing'
import { encodeSettingValue } from '@dltech/atlas-wire/web'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { sealSecretValue } from '../secrets/sealed-secret'
import { seedProject, seedWorkspace } from '../web-settings.fake-db'

export const ORG = 'org-1'
export const PROJECT = 'proj-1'
export const THREAD = 'thr-1'
export const KEY = 'model.effort'

export const setting = (value: string): string => encodeSettingValue(value)

export async function seedAllScopes(cipher: SecretCipherService): Promise<void> {
  const seal = (value: string) => sealSecretValue({ cipher, value })
  await seedWorkspace({ id: ORG, members: [{ userId: 'user-a', role: 'owner' }] })
  await seedProject({ id: PROJECT, ownerUserId: 'user-a', organizationId: ORG })
  await seedThread({ db, id: THREAD, userId: 'user-a', projectId: PROJECT })
  await db.orm.public.WorkspaceSetting.create({
    id: 'w1',
    organizationId: ORG,
    key: KEY,
    value: setting('low'),
  })
  await db.orm.public.UserSetting.createAll([
    { id: 'u1', userId: 'user-a', key: KEY, value: setting('medium') },
    { id: 'u2', userId: 'user-a', key: 'sandbox.vercelTeamId', value: setting('team_user') },
  ])
  await db.orm.public.ProjectSetting.createAll([
    { id: 'p1', projectId: PROJECT, key: KEY, value: setting('high') },
  ])
  await db.orm.public.WorkspaceSecret.create({
    id: 's1',
    organizationId: ORG,
    name: 'API',
    kind: 'secret',
    sealedValue: seal('ws'),
  })
  await db.orm.public.UserSecret.createAll([
    { id: 's2', userId: 'user-a', name: 'API', kind: 'secret', sealedValue: seal('user') },
    {
      id: 's3',
      userId: 'user-a',
      name: 'sandbox.vercelToken',
      kind: 'secret',
      sealedValue: seal('vtok_user'),
    },
  ])
  await db.orm.public.ProjectSecret.create({
    id: 's4',
    projectId: PROJECT,
    name: 'API',
    kind: 'env',
    sealedValue: seal('proj'),
  })
  await db.orm.public.WorkspaceVercelCredential.create({
    organizationId: ORG,
    sealedToken: seal('vtok_workspace'),
    teamId: 'team_ws',
    vercelProjectId: 'prj_ws',
  })
  await db.orm.public.UserVercelCredential.create({
    userId: 'user-a',
    sealedToken: seal('vtok_personal'),
    teamId: 'team_personal',
    vercelProjectId: 'prj_personal',
  })
}
