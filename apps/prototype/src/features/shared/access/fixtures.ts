export type FixtureSecret = { name: string; updated: string }
export type FixtureFile = { path: string; mode: string; updated: string }

export type FixtureGrant = {
  id: string
  name: string
  instruction: string
  secrets: FixtureSecret[]
  files: FixtureFile[]
}

export const PROJECT_GRANTS: FixtureGrant[] = [
  {
    id: 'g1',
    name: 'PlanetScale admin',
    instruction:
      'These two variables give the pscale CLI full access to the app database. Use it to read schema and run migrations.',
    secrets: [
      { name: 'PLANETSCALE_SERVICE_TOKEN', updated: '3d ago' },
      { name: 'PLANETSCALE_ORG', updated: '3d ago' },
    ],
    files: [],
  },
  {
    id: 'g2',
    name: 'Deploy to production',
    instruction: 'The gh token lets Atlas open pull requests and read CI for this repository.',
    secrets: [{ name: 'GITHUB_TOKEN', updated: '1w ago' }],
    files: [{ path: '~/.config/gh/hosts.yml', mode: '0600', updated: '1w ago' }],
  },
  {
    id: 'g3',
    name: 'Local app config',
    instruction: '',
    secrets: [],
    files: [{ path: '.env.local', mode: '0600', updated: '2w ago' }],
  },
]

export const PERSONAL_GRANTS: FixtureGrant[] = [
  {
    id: 'p1',
    name: 'OpenAI',
    instruction: 'One key for every project that calls OpenAI.',
    secrets: [{ name: 'OPENAI_API_KEY', updated: '4d ago' }],
    files: [],
  },
  {
    id: 'p2',
    name: 'GitHub CLI',
    instruction: 'The gh CLI signs in as me in every sandbox.',
    secrets: [{ name: 'GH_TOKEN', updated: '1w ago' }],
    files: [{ path: '~/.config/gh/hosts.yml', mode: '0600', updated: '1w ago' }],
  },
]
