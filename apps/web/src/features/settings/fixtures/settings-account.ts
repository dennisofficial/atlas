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
  {
    id: 'linear',
    name: 'Linear',
    brand: EBrand.Linear,
    description: 'Link threads to issues and update their status as work lands.',
    capabilities: [
      { label: 'Read issues', granted: false },
      { label: 'Comment on issues', granted: false },
      { label: 'Update issue status', granted: false },
    ],
  },
]

export type Experiment = {
  id: string
  title: string
  description: string
  enabled: boolean
  beta?: boolean
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'parallel-tool-calls',
    title: 'Parallel tool calls',
    description: 'Run independent read-only tool calls from one model turn at the same time.',
    enabled: true,
    beta: true,
  },
  {
    id: 'speculative-classifier',
    title: 'Speculative classifier',
    description: 'Start the permission classifier while the model is still streaming the call.',
    enabled: false,
  },
  {
    id: 'auto-compact',
    title: 'Auto-compact at 70%',
    description: 'Summarize older turns automatically once the context window is 70% full.',
    enabled: true,
  },
  {
    id: 'born-in-cloud',
    title: 'Born-in-cloud threads',
    description: 'Start new threads in a Vercel sandbox instead of on this machine.',
    enabled: false,
    beta: true,
  },
  {
    id: 'web-terminal',
    title: 'Web terminal in session panel',
    description: "Attach a terminal to the thread's sandbox from the session side panel.",
    enabled: true,
    beta: true,
  },
  {
    id: 'plan-mode-default',
    title: 'Plan mode by default',
    description: 'New threads open in plan mode and wait for approval before editing files.',
    enabled: false,
  },
]
