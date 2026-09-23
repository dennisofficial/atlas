import type { ThreadId } from '@dltech/atlas-core'

export class ForkSourceMissing extends Error {
  constructor({ from }: { from: ThreadId }) {
    super(`cannot fork ${from}: no such thread`)
    this.name = 'ForkSourceMissing'
  }
}

export class ForkSeqOutOfRange extends Error {
  constructor({ from, seq, head }: { from: ThreadId; seq: number; head: number }) {
    super(`cannot fork ${from} at ${seq}: the thread runs from 0 to ${head}`)
    this.name = 'ForkSeqOutOfRange'
  }
}
