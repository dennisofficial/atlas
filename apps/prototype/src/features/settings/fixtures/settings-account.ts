import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export type IntegrationCapability = {
  label: string
  granted: boolean
}

export type Integration = {
  id: string
  name: string
  brand: EBrand
  connectedAs?: string
  capabilities: IntegrationCapability[]
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    brand: EBrand.GitHub,
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
