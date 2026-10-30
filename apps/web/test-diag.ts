import { afterAll, afterEach, beforeAll } from 'bun:test'

const snapshot = (phase: string) => {
  const w = globalThis as unknown as {
    window?: { closed?: boolean; happyDOM?: unknown }
    document?: { body?: { isConnected?: boolean } }
    sessionStorage?: {
      setItem: (k: string, v: string) => void
      getItem: (k: string) => string | null
    }
    happyDOM?: unknown
  }
  let storage = 'none'
  try {
    w.sessionStorage?.setItem('__diag', '1')
    storage = String(w.sessionStorage?.getItem('__diag'))
  } catch (error) {
    storage = `throws:${String(error)}`
  }
  console.log(
    `[diag] ${phase} t=${performance.now().toFixed(1)} window=${typeof w.window} closed=${String(w.window?.closed)} happyDOM=${typeof w.happyDOM} bodyConnected=${String(w.document?.body?.isConnected)} storage=${storage}`,
  )
}

beforeAll(() => snapshot('file-start'))
afterEach(() => snapshot('test-end'))
afterAll(() => snapshot('file-end'))
