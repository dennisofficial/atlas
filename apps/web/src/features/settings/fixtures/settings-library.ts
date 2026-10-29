export type LibraryMember = {
  name: string
  initials: string
}

export type LibrarySecret = {
  id: string
  key: string
  updated: string
  addedBy: LibraryMember
}

const DENNIS: LibraryMember = { name: 'Dennis Lysenko', initials: 'DL' }

export const PERSONAL_SECRETS: LibrarySecret[] = [
  {
    id: 'p1',
    key: 'ANTHROPIC_API_KEY',
    updated: '3d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p2',
    key: 'OPENAI_API_KEY',
    updated: '3d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p3',
    key: 'VERCEL_TOKEN',
    updated: '2w ago',
    addedBy: DENNIS,
  },
  {
    id: 'p4',
    key: 'NPM_TOKEN',
    updated: '6w ago',
    addedBy: DENNIS,
  },
  {
    id: 'p5',
    key: 'ATLAS_LOG_LEVEL',
    updated: '1d ago',
    addedBy: DENNIS,
  },
  {
    id: 'p6',
    key: 'NODE_ENV',
    updated: '5w ago',
    addedBy: DENNIS,
  },
]
