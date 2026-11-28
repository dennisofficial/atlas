import { EAccessScope, type AccessScope } from '@dltech/atlas-wire/web'

export type AccessRouteParams = {
  scope?: string
  scopeId?: string
  grantId?: string
  name?: string
  mode?: string
}

export const accessScopeOfParams = (params: AccessRouteParams): AccessScope => {
  if (params.scope === EAccessScope.Project && params.scopeId)
    return { kind: EAccessScope.Project, projectId: params.scopeId }
  if (params.scope === EAccessScope.Group && params.scopeId)
    return { kind: EAccessScope.Group, groupId: params.scopeId }
  return { kind: EAccessScope.Personal }
}

export const accessParamsOfScope = (scope: AccessScope): AccessRouteParams => {
  if (scope.kind === EAccessScope.Project) return { scope: scope.kind, scopeId: scope.projectId }
  if (scope.kind === EAccessScope.Group) return { scope: scope.kind, scopeId: scope.groupId }
  return { scope: scope.kind }
}
