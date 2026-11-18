import { newKey, type RemoteCalls } from '@dltech/atlas-host'
import { ECallStatus, EShellRunStatus } from '@dltech/atlas-protocol'

export const countRunningShells = async (args: { calls: RemoteCalls }): Promise<number> => {
  const key = newKey()
  try {
    const result = await args.calls.invoke({ key, op: { op: 'shells.list' } })
    if (result.status !== ECallStatus.Ok) throw new Error(result.error.message)
    if (result.op !== 'shells.list') throw new Error(`unexpected result for ${result.op}`)
    return result.value.filter((shell) => shell.status === EShellRunStatus.Running).length
  } finally {
    await args.calls.ack({ key }).catch(() => undefined)
  }
}
