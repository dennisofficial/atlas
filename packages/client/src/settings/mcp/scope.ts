import {
  EMcpServerScope,
  type McpOauthScreen,
  type McpServerScope,
  type ScopedMcpServerPut,
} from '@dltech/atlas-wire/web'

import { upsertOfServerDraft, type McpServerDraft } from './mapping'

export type McpScope =
  | { readonly kind: 'user' }
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string }

export const mcpServersInputOf = (scope: McpScope): McpServerScope => {
  if (scope.kind === 'project') return { scope: EMcpServerScope.Project, projectId: scope.id }
  if (scope.kind === 'group') return { scope: EMcpServerScope.Group, groupId: scope.id }
  return { scope: EMcpServerScope.Personal }
}

export const mcpOauthScreenOfScope = (scope: McpScope): McpOauthScreen => {
  if (scope.kind === 'project') return { kind: 'settings', scope: 'project', id: scope.id }
  if (scope.kind === 'group') return { kind: 'settings', scope: 'group', id: scope.id }
  return { kind: 'settings', scope: 'user' }
}

export const mcpServerPutInputOf = ({
  scope,
  draft,
}: {
  scope: McpScope
  draft: McpServerDraft
}): ScopedMcpServerPut => ({
  ...mcpServersInputOf(scope),
  name: draft.id,
  ...upsertOfServerDraft(draft),
})
