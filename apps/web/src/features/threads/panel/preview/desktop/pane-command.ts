export type PaneRect = { x: number; y: number; width: number; height: number }

export type PaneCommand =
  | { kind: 'show'; url: string; rect: PaneRect }
  | { kind: 'hide' }
  | { kind: 'setRect'; rect: PaneRect }
  | { kind: 'navigate'; url: string }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' }
  | { kind: 'stop' }
  | { kind: 'setObscured'; obscured: boolean }
