import type { Control } from '@/proto/use-prototype'

import { type AppRoutine, ROUTINES } from './routines.fixtures'

export const ROUTINE_CONTROLS = {
  state: { type: 'select', label: 'State', options: ['populated', 'empty'], default: 'populated' },
} satisfies Record<string, Control>

export const routinesOfParams = (params: Pick<URLSearchParams, 'get'>): readonly AppRoutine[] =>
  params.get('state') === 'empty' ? [] : ROUTINES
