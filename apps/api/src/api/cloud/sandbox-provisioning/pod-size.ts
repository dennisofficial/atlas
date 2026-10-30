import { db } from '@dltech/atlas-db'
import { decodeSettingValue, validateCloudSetting } from '@dltech/atlas-wire/web'

const SANDBOX_VCPUS_KEY = 'sandbox.vcpus'

async function projectVcpusOf(sessionId: string): Promise<number | undefined> {
  const session = await db.orm.public.Session.where({ id: sessionId }).select('projectId').first()
  if (session?.projectId == null) return undefined
  const project = await db.orm.public.Project.where({ id: session.projectId })
    .select('sandboxVcpus')
    .first()
  return project?.sandboxVcpus ?? undefined
}

async function personalVcpusOf(userId: string | undefined): Promise<number | undefined> {
  if (userId === undefined) return undefined
  const row = await db.orm.public.UserSetting.where({ userId, key: SANDBOX_VCPUS_KEY })
    .select('value')
    .first()
  if (row === null) return undefined
  if (!validateCloudSetting({ key: SANDBOX_VCPUS_KEY, stored: row.value }).ok) return undefined
  const value = decodeSettingValue(row.value)
  return typeof value === 'number' ? value : undefined
}

/** The creation-time vCPUs for a pod: the session's project size, else the owner's `sandbox.vcpus`. */
export async function podVcpusOf(args: {
  sessionId: string
  userId: string | undefined
}): Promise<number | undefined> {
  return (await projectVcpusOf(args.sessionId)) ?? (await personalVcpusOf(args.userId))
}
