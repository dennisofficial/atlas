import type { AccessFileRow, AccessGrantRow, AccessRows } from '../config/access-rows'
import { isExportedSecretName } from './env-secrets'

export const ACCESS_SLOT = 'access'
export const ACCESS_KEY = 'current'

const NO_ACCESS =
  'Atlas Cloud gives you no secrets or access grants in this session. The operator adds them in the Secrets, Files and Access settings of Atlas Cloud.'

const INTRO = 'Atlas Cloud gives you this access. The operator wrote each description.'

const SECRET_USE =
  'Use a secret by name, for example "$NAME" in a command. Do not ask the operator for the values. Never print, log or commit them.'

const SETTINGS =
  'The operator changes this access in the Secrets, Files and Access settings of Atlas Cloud. A secret change reaches new shells without a restart. A file change reaches the sandbox at its next start.'

enum EGrantScope {
  Project = 'project',
  User = 'user',
}

type Grant = AccessGrantRow & { scope: EGrantScope }

type EffectiveSecret = { name: string; scope: EGrantScope; grantId: string | null }

const byName = (left: { name: string }, right: { name: string }): number =>
  left.name.localeCompare(right.name)

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

type Members = {
  names: Map<string, string[]>
  paths: Map<string, string[]>
  ungrouped: string[]
}

const membersOf = (args: {
  grants: readonly Grant[]
  secrets: readonly EffectiveSecret[]
  files: readonly AccessFileRow[]
}): Members => {
  const known = new Set(args.grants.map(grantKeyOf))
  const members: Members = { names: new Map(), paths: new Map(), ungrouped: [] }
  for (const secret of args.secrets) {
    const key =
      secret.grantId === null ? null : grantKeyOf({ scope: secret.scope, id: secret.grantId })
    if (key === null || !known.has(key)) {
      members.ungrouped.push(secret.name)
      continue
    }
    members.names.set(key, [...(members.names.get(key) ?? []), secret.name])
  }
  for (const file of args.files) {
    const key =
      file.grantId === null ? null : grantKeyOf({ scope: EGrantScope.Project, id: file.grantId })
    if (key === null || !known.has(key)) continue
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
  const members = membersOf({ grants, secrets, files: rows.projectFiles })

  const sections: string[] = []
  for (const grant of grants) {
    const key = grantKeyOf(grant)
    sections.push(
      grantSectionOf({
        grant,
        names: members.names.get(key) ?? [],
        paths: (members.paths.get(key) ?? []).sort((left, right) => left.localeCompare(right)),
      }),
    )
  }
  if (members.ungrouped.length > 0) {
    sections.push(
      ['Other secrets', ...memberLine('Environment variables', members.ungrouped)].join('\n'),
    )
  }
  if (sections.length === 0) return NO_ACCESS

  return [INTRO, ...sections, ...(secrets.length === 0 ? [] : [SECRET_USE]), SETTINGS].join('\n\n')
}
