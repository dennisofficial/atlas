import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export enum EWorkspaceRole {
  Owner = 'Owner',
  Member = 'Member',
}

export type WorkspaceMembership = {
  id: string
  name: string
  initial: string
  role: EWorkspaceRole
  memberCount: number
}

export const WORKSPACE_MEMBERSHIPS: WorkspaceMembership[] = [
  { id: 'dltech', name: 'DL Tech', initial: 'D', role: EWorkspaceRole.Owner, memberCount: 6 },
  { id: 'rs-crm', name: 'rs-crm', initial: 'R', role: EWorkspaceRole.Member, memberCount: 3 },
]

export type IntegrationCapability = {
  label: string
  granted: boolean
}

export type Integration = {
  id: string
  name: string
  brand: EBrand
  description: string
  connectedAs?: string
  capabilities: IntegrationCapability[]
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    brand: EBrand.GitHub,
    description: 'Clone repositories and open pull requests from threads.',
    connectedAs: 'dennisofficial',
    capabilities: [
      { label: 'Clone private repos', granted: true },
      { label: 'Open pull requests', granted: true },
      { label: 'Org-wide access', granted: false },
    ],
  },
]

export type SignInMethods = {
  google: boolean
  password: boolean
}

export const SIGN_IN_METHODS_BOTH: SignInMethods = { google: true, password: true }
export const SIGN_IN_METHODS_GOOGLE_ONLY: SignInMethods = { google: true, password: false }
export const SIGN_IN_METHODS_PASSWORD_ONLY: SignInMethods = { google: false, password: true }
