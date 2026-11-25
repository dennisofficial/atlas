import type { AccessGrantRow, AccessRows } from '../config/access-rows'
import { isExportedSecretName } from './env-secrets'

export const ACCESS_SLOT = 'access'
export const ACCESS_KEY = 'current'

const NO_ACCESS =
  'Atlas Cloud gives you no secrets or access grants in this session. When the operator approves an access change, it appears here.'

const INTRO = 'Atlas Cloud gives you this access. The operator wrote each description.'

const SECRET_USE =
  'Use a secret by name, for example "$NAME" in a command. Do not ask the operator for the values. Never print, log or commit them.'

const SETTINGS =
  'The operator changes this access in the Access settings of Atlas Cloud, or you change it with the cloud_config tool when the operator asks. A secret change reaches new shells without a restart. A file change reaches the sandbox at its next start.'

enum EGrantScope {
  Project = 'project',
  User = 'user',
}

type Grant = AccessGrantRow & { scope: EGrantScope }

type EffectiveSecret = { name: string; scope: EGrantScope; grantId: string }

type EffectiveFile = { path: string; scope: EGrantScope; grantId: string }

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name)

const byPath = (left: { path: string }, right: { path: string }): number =>
  left.path.localeCompare(right.path)

const grantKeyOf = (grant: { scope: EGrantScope; id: string }): string =>
  `${grant.scope}:${grant.id}`

const grantsOf = (rows: AccessRows): readonly Grant[] => {
  const project = rows.projectGrants.map((grant) => ({ ...grant, scope: EGrantScope.Project }))
  const user = rows.userGrants.map((grant) => ({ ...grant, scope: EGrantScope.User }))
  return [...project.sort(byName), ...user.sort(byName)]
}

const effectiveSecretsOf = (rows: AccessRows): readonly EffectiveSecret[] => {
  const secretByName = new Map<string, EffectiveSecret>()
  for (const secret of rows.userSecrets) {
    if (isExportedSecretName(secret.name)) {
      secretByName.set(secret.name, {
        name: secret.name,
        scope: EGrantScope.User,
        grantId: secret.grantId,
      })
    }
  }
  for (const secret of rows.projectSecrets) {
    if (isExportedSecretName(secret.name)) {
      secretByName.set(secret.name, {
        name: secret.name,
        scope: EGrantScope.Project,
        grantId: secret.grantId,
      })
    }
  }
  return [...secretByName.values()].sort(byName)
}

const effectiveFilesOf = (rows: AccessRows): readonly EffectiveFile[] => {
  const project = rows.projectFiles.map((file) => ({
    path: file.path,
    scope: EGrantScope.Project,
    grantId: file.grantId,
  }))
  const hidden = new Set(project.map((file) => file.path))
  const user = rows.userFiles
    .filter((file) => !hidden.has(file.path))
    .map((file) => ({ path: file.path, scope: EGrantScope.User, grantId: file.grantId }))
  return [...project, ...user].sort(byPath)
}

type Members = {
  names: Map<string, string[]>
  paths: Map<string, string[]>
}

const memberKeyOf = (member: { scope: EGrantScope; grantId: string }): string =>
  grantKeyOf({ scope: member.scope, id: member.grantId })

const membersOf = (args: {
  grants: readonly Grant[]
  secrets: readonly EffectiveSecret[]
  files: readonly EffectiveFile[]
}): Members => {
  const known = new Set(args.grants.map(grantKeyOf))
  const members: Members = { names: new Map(), paths: new Map() }
  for (const secret of args.secrets) {
    const key = memberKeyOf(secret)
    if (!known.has(key)) continue
    members.names.set(key, [...(members.names.get(key) ?? []), secret.name])
  }
  for (const file of args.files) {
    const key = memberKeyOf(file)
    if (!known.has(key)) continue
    members.paths.set(key, [...(members.paths.get(key) ?? []), file.path])
  }
  return members
}

const memberLine = (label: string, values: readonly string[]): readonly string[] =>
  values.length === 0 ? [] : [`${label}: ${values.join(', ')}`]

const grantSectionOf = (args: {
  grant: Grant
  names: readonly string[]
  paths: readonly string[]
}): string => {
  const instruction = args.grant.instruction.trim()
  return [
    args.grant.name,
    ...memberLine('Environment variables', args.names),
    ...memberLine('Files', args.paths),
    ...(instruction === '' ? [] : [instruction]),
  ].join('\n')
}

export const accessNoticeOf = (rows: AccessRows): string => {
  const grants = grantsOf(rows)
  const secrets = effectiveSecretsOf(rows)
  const members = membersOf({ grants, secrets, files: effectiveFilesOf(rows) })

  const sections = grants.map((grant) => {
    const key = grantKeyOf(grant)
    return grantSectionOf({
      grant,
      names: members.names.get(key) ?? [],
      paths: members.paths.get(key) ?? [],
    })
  })
  if (sections.length === 0) return NO_ACCESS

  return [INTRO, ...sections, ...(secrets.length === 0 ? [] : [SECRET_USE]), SETTINGS].join('\n\n')
}
