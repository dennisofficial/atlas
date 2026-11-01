export enum EForkResolution {
  Resolved = 'resolved',
  Deferred = 'deferred',
}

export class RedeliveryDeferred extends Error {
  constructor() {
    super('the thread is mid-turn, so a redelivered message would not be durable yet')
    this.name = 'RedeliveryDeferred'
  }
}
