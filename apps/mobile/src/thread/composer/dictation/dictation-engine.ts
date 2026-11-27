export enum EDictationEvent {
  Level = 'level',
  Partial = 'partial',
  Final = 'final',
  Error = 'error',
  Ended = 'ended',
}

export type TDictationEvent =
  | { type: EDictationEvent.Level; level: number }
  | { type: EDictationEvent.Partial; text: string }
  | { type: EDictationEvent.Final; text: string }
  | { type: EDictationEvent.Error; message: string }
  | { type: EDictationEvent.Ended }

export interface IDictationSession {
  stop(): Promise<void>
  cancel(): void
}

export interface IDictationEngine {
  start(params: { onEvent: (event: TDictationEvent) => void }): Promise<IDictationSession>
}

export const MICROPHONE_DENIED_MESSAGE = 'Atlas needs microphone access to dictate.'

export const recordingFailedMessageOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : 'Dictation could not start.'
