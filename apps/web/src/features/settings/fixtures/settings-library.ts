export enum ESecretKind {
  Secret = 'secret',
  EnvVar = 'env',
}

export type LibraryMember = {
  name: string
  initials: string
}

export type LibrarySecret = {
  id: string
  key: string
  kind: ESecretKind
  value: string
  updated: string
  addedBy: LibraryMember
}

const DENNIS: LibraryMember = { name: 'Dennis Lysenko', initials: 'DL' }

export const PERSONAL_SECRETS: LibrarySecret[] = [
  {
    id: 'p1',
    key: 'ANTHROPIC_API_KEY',
    kind: ESecretKind.Secret,
    value: 'sk-ant-api03-w8Kq',
    updated: '3d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p2',
    key: 'OPENAI_API_KEY',
    kind: ESecretKind.Secret,
    value: 'sk-proj-m4Rz',
    updated: '3d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p3',
    key: 'VERCEL_TOKEN',
    kind: ESecretKind.Secret,
    value: 'vcp_9fT2xLq',
    updated: '2w ago',
    addedBy: DENNIS,
  },
  {
    id: 'p4',
    key: 'NPM_TOKEN',
    kind: ESecretKind.Secret,
    value: 'npm_hd7Q1vB',
    updated: '6w ago',
    addedBy: DENNIS,
  },
  {
    id: 'p5',
    key: 'ATLAS_LOG_LEVEL',
    kind: ESecretKind.EnvVar,
    value: 'debug',
    updated: '1d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p6',
    key: 'NODE_ENV',
    kind: ESecretKind.EnvVar,
    value: 'development',
    updated: '5w ago',
    addedBy: DENNIS,
  },
]
