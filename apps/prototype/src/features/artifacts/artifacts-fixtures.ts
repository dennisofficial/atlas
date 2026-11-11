export interface ProtoArtifact {
  slug: string
  name: string
  status: 'ready' | 'building' | 'failed'
  updated: string
}

export const PROTO_ARTIFACTS: ProtoArtifact[] = [
  { slug: 'atlas-landing', name: 'Atlas landing', status: 'ready', updated: '8m ago' },
  { slug: 'launch-deck', name: 'Launch deck', status: 'building', updated: '2h ago' },
  { slug: 'pricing-table', name: 'Pricing table', status: 'failed', updated: 'yesterday' },
]
