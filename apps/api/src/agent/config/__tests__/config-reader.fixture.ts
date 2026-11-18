import { createDb, createPool, type Db, type Pool } from '@dltech/atlas-db'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'

import { SecretCipher } from '../secret-cipher'

export const KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
export const cipher = new SecretCipher(KEY)

export const sealed = (value: unknown): string => cipher.encrypt(JSON.stringify(value))

export const seedOwner = async (db: Db): Promise<void> => {
  await db.orm.public.User.create({ id: 'user-1', name: 'u', email: 'u@test.local' })
  await db.orm.public.Project.create({
    id: 'proj-1',
    name: 'p',
    ownerUserId: 'user-1',
    repo: 'acme/app',
    baseBranch: 'main',
    setupScript: 'bun install',
    additionalRepos: [{ repo: 'acme/lib', branch: 'dev' }],
  })
  await new ControlPlane({ store: new PostgresControlStore(db) }).createSession({
    sessionId: 's-1',
    userId: 'user-1',
    projectId: 'proj-1',
    mainThreadId: 't-1',
  })
}

export const seedVercel = async (db: Db, over: Record<string, unknown> = {}): Promise<void> => {
  await db.orm.public.UserVercelCredential.create({
    userId: 'user-1',
    kind: 'token',
    sealedToken: sealed('vercel-token'),
    teamId: 'team-1',
    vercelProjectId: 'vproj-1',
    ...over,
  })
}

export const seedApiKeyAccount = async (
  args: Db | { db: Db; id: string; provider: string; apiKey: string },
): Promise<void> => {
  const { db, id, provider, apiKey } =
    'db' in args ? args : { db: args, id: 'acct-1', provider: 'anthropic', apiKey: 'sk-test' }
  await db.orm.public.AgentAccount.create({
    id,
    userId: 'user-1',
    provider,
    kind: 'api-key',
    origin: 'login',
    label: 'key',
    status: 'active',
    sealedSecret: sealed({ kind: 'api-key', apiKey }),
  })
  await db.orm.public.ActiveAccount.create({ userId: 'user-1', provider, accountId: id })
}

export const seedThread = async (db: Db, over: Record<string, unknown> = {}): Promise<void> => {
  const existing = await db.orm.public.Session.first({ id: 's-1' })
  if (existing === null) {
    await db.orm.public.Session.create({
      id: 's-1',
      userId: 'user-1',
      projectId: 'proj-1',
      title: 't',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  await db.orm.public.Thread.create({
    id: 't-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    sessionId: 's-1',
    userId: 'user-1',
    modelRef: 'anthropic/claude-haiku-4-5',
    modelEffort: 'high',
    modelFast: false,
    ...over,
  })
}

export const seedSetting = async (args: {
  db: Db
  scope: 'user' | 'project'
  value: string | boolean
  key?: string
}): Promise<void> => {
  const key = args.key ?? 'model.id'
  const encoded = `atlas-setting:v1:${JSON.stringify(args.value)}`
  const id = `${args.scope}-${key}-${String(args.value)}`
  if (args.scope === 'user') {
    await args.db.orm.public.UserSetting.create({ id, userId: 'user-1', key, value: encoded })
    return
  }
  await args.db.orm.public.ProjectSetting.create({
    id,
    projectId: 'proj-1',
    key,
    value: encoded,
  })
}

export const seedSkill = async (args: {
  db: Db
  name: string
  scope: 'user' | 'project'
  description?: string
}): Promise<void> => {
  const owner = args.scope === 'user' ? { userId: 'user-1' } : { projectId: 'proj-1' }
  const skill = await args.db.orm.public.Skill.create({
    name: args.name,
    description: args.description ?? `${args.name} description`,
    ...owner,
  })
  await args.db.orm.public.SkillFile.create({
    skillId: skill.id,
    path: 'SKILL.md',
    revision: 1,
    contentHash: 'h',
    content: Buffer.from('body'),
    isText: true,
    size: 4,
  })
}

export const recordingDb = (args: {
  url: string
}): { db: Db; sql: string[]; end(): Promise<void> } => {
  const sql: string[] = []
  const pool = createPoolRecording({ url: args.url, sql })
  return { db: createDb(pool), sql, end: () => pool.end() }
}

const textOf = (query: unknown): string => {
  if (typeof query === 'string') return query
  if (typeof query === 'object' && query !== null && 'text' in query) return String(query.text)
  return ''
}

const createPoolRecording = (args: { url: string; sql: string[] }): Pool => {
  const pool = createPool(args.url)
  const query = pool.query.bind(pool) as (...a: unknown[]) => unknown
  Object.assign(pool, {
    query: (...a: unknown[]) => {
      args.sql.push(textOf(a[0]))
      return query(...a)
    },
  })
  const connect = pool.connect.bind(pool) as () => Promise<{ query: (...a: unknown[]) => unknown }>
  Object.assign(pool, {
    connect: async () => {
      const client = await connect()
      const clientQuery = client.query.bind(client)
      client.query = (...a: unknown[]) => {
        args.sql.push(textOf(a[0]))
        return clientQuery(...a)
      }
      return client
    },
  })
  return pool
}
