export type ContextReadiness = {
  written: number
  failed: string | null
  projectDirectory: string | null
  identity: string | null
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
