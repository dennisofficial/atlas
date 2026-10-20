export type MemoryIndexState = {
  text: string | null
  lastFailed: boolean
  loading: Promise<void> | null
}

export const newMemoryIndexState = (): MemoryIndexState => ({
  text: null,
  lastFailed: false,
  loading: null,
})
