import REAL from '../../fixtures/real-transcript.json'

export interface RealCall {
  id: string
  kind: string
  state: string
  label: string
  title?: string
  output?: string
  errorText?: string
  elapsed?: string
}

export type RealWorkItem =
  | { kind: 'thought'; id: string; text: string }
  | { kind: 'tools'; id: string; calls: RealCall[] }

export type RealSegment =
  | { kind: 'message'; id: string; text: string }
  | { kind: 'work'; id: string; duration: string; stepCount: number; items: RealWorkItem[] }

export interface RealSpawn {
  id: string
  name: string
  elapsed: string
  brief: string
  result: string
}

export type RealTurn =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; segments: RealSegment[]; spawns: RealSpawn[] }

const CYCLES = 12

export const REAL_TURNS: RealTurn[] = Array.from({ length: CYCLES }, (_, cycle) =>
  (REAL.turns as RealTurn[]).map((turn) => ({ ...turn, id: `${cycle}:${turn.id}` })),
).flat()
