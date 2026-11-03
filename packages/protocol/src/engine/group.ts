import type { CallOp, DaemonEvent, OpName, OpOf, OpValue } from '../ops'

export type CallContext = {
  key: string
  signal: AbortSignal
  output(bytes: Uint8Array): void
  publish(event: DaemonEvent): void
}

export type RegisteredOp = {
  op: OpName
  run(args: { op: CallOp; ctx: CallContext }): Promise<unknown>
}

const isOp = <K extends OpName>(args: {
  op: CallOp
  name: K
}): args is {
  op: OpOf<K>
  name: K
} => args.op.op === args.name

export const defineOp = <K extends OpName>(args: {
  op: K
  run(args: { op: OpOf<K>; ctx: CallContext }): Promise<OpValue<K>>
}): RegisteredOp => ({
  op: args.op,
  run: async ({ op, ctx }) => {
    const narrowed = { op, name: args.op }
    if (!isOp(narrowed)) throw new Error(`${args.op} handler received ${op.op}`)
    return await args.run({ op: narrowed.op, ctx })
  },
})

export type GroupContext = {
  publish(event: DaemonEvent): void
}

export type DaemonGroup = {
  name: string
  ops: readonly RegisteredOp[]
  onConnect?(args: { epoch: number }): void
  onDisconnect?(): void
  stop?(): Promise<void>
}

export type DaemonGroupFactory = (ctx: GroupContext) => DaemonGroup
