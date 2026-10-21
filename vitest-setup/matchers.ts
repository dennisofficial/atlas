import { expect } from 'vitest'

expect.extend({
  toStartWith(received: unknown, prefix: string) {
    const pass = typeof received === 'string' && received.startsWith(prefix)
    return {
      pass,
      message: () => `expected ${this.utils.printReceived(received)} ${pass ? 'not ' : ''}to start with ${this.utils.printExpected(prefix)}`,
    }
  },
  toEndWith(received: unknown, suffix: string) {
    const pass = typeof received === 'string' && received.endsWith(suffix)
    return {
      pass,
      message: () => `expected ${this.utils.printReceived(received)} ${pass ? 'not ' : ''}to end with ${this.utils.printExpected(suffix)}`,
    }
  },
  toBeString(received: unknown) {
    const pass = typeof received === 'string'
    return {
      pass,
      message: () => `expected ${this.utils.printReceived(received)} ${pass ? 'not ' : ''}to be a string`,
    }
  },
})
