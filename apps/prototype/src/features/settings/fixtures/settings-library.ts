export enum ESecretKind {
  Secret = 'secret',
  EnvVar = 'env',
}

export enum ESecretsScope {
  Personal = 'personal',
  Project = 'project',
  Workspace = 'workspace',
}

export type LibrarySecret = {
  id: string
  key: string
  kind: ESecretKind
  value: string
  updated: string
  scope: ESecretsScope
}

export const PERSONAL_SECRETS: LibrarySecret[] = [
  {
    id: 'p1',
    key: 'ANTHROPIC_API_KEY',
    kind: ESecretKind.Secret,
    value: 'sk-ant-api03-Hd3Wn8qYc1uJb5sF0vRa',
    updated: '3d ago',
    scope: ESecretsScope.Personal,
  },
  {
    id: 'p2',
    key: 'OPENAI_API_KEY',
    kind: ESecretKind.Secret,
    value: 'sk-proj-m4RzK9fT2qWx',
    updated: '3d ago',
    scope: ESecretsScope.Personal,
  },
  {
    id: 'p3',
    key: 'NPM_TOKEN',
    kind: ESecretKind.Secret,
    value: 'npm_hd7Q1vB3nLs8',
    updated: '6w ago',
    scope: ESecretsScope.Personal,
  },
  {
    id: 'p4',
    key: 'ATLAS_LOG_LEVEL',
    kind: ESecretKind.EnvVar,
    value: 'debug',
    updated: '1d ago',
    scope: ESecretsScope.Personal,
  },
  {
    id: 'p5',
    key: 'NODE_ENV',
    kind: ESecretKind.EnvVar,
    value: 'development',
    updated: '5w ago',
    scope: ESecretsScope.Personal,
  },
]

export const BULK_ADD_SAMPLE = `OPENAI_API_KEY=sk-proj-9fK2
POSTHOG_KEY=phc_live_41b0
# staging only
SENTRY_DSN=https://4c1@o12.ingest.sentry.io/77
not a pair`
