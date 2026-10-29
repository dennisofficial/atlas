import { EShipBehavior } from '@dltech/atlas-wire/web'

export { EShipBehavior }

export const SHIP_BEHAVIORS: readonly {
  value: EShipBehavior
  label: string
  description: string
}[] = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: 'Open pull request',
    description: 'Push a branch and open a PR for review.',
  },
  {
    value: EShipBehavior.Push,
    label: 'Push branch',
    description: 'Push the branch; you open the PR yourself.',
  },
]

export interface SecretRow {
  name: string
  updated: string
}

export enum EMcpTransport {
  Stdio = 'stdio',
  Http = 'http',
}
