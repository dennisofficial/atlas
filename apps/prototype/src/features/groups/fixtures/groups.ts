export type GroupProjectFixture = { id: string; name: string; repo: string }

export type GroupFixture = {
  id: string
  name: string
  summary: string
  projects: GroupProjectFixture[]
}

export const GROUPS: GroupFixture[] = [
  {
    id: 'comp-ai',
    name: 'Comp AI',
    summary: 'Every product that ships on the Comp AI stack.',
    projects: [
      { id: 'comp', name: 'comp', repo: 'trycompai/comp' },
      { id: 'comp-neo', name: 'comp-neo', repo: 'trycompai/comp-neo' },
      { id: 'atlas', name: 'atlas', repo: 'dennisofficial/atlas' },
    ],
  },
  {
    id: 'client-work',
    name: 'Client work',
    summary: 'Projects for clients, kept apart from the products.',
    projects: [
      { id: 'rs-crm', name: 'rs-crm-app', repo: 'dennisofficial/rs-crm-app' },
      { id: 'rcp', name: 'RCP', repo: 'dennisofficial/rcp' },
    ],
  },
]

export const groupById = (id: string): GroupFixture | null =>
  GROUPS.find((group) => group.id === id) ?? null
