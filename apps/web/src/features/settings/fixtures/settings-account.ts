import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

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
  missingScopes?: string[]
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
