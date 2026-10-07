import { basename } from 'node:path'
import { stat } from 'node:fs/promises'
import { liveSdk, VercelDriver, type VercelSandboxConfig } from '@dltech/atlas-harness'
import { liveDriveSdk } from '../../../../packages/harness/src/cloud/drive-lifecycle'
import { measured, type BenchmarkRecorder } from './timing'

export class BenchmarkDriver extends VercelDriver {
  constructor(
    args: VercelSandboxConfig & {
      record: BenchmarkRecorder
      cloudUrl: string
      onDriverLog?: ((line: string) => void) | undefined
    },
  ) {
    const { record, onDriverLog } = args
    super({
      ...args,
      log: (line) => {
        record({ phase: 'driver', line })
        onDriverLog?.(line)
      },
      sdk: {
        get: (params) =>
          measured({
            name: 'sandbox-lookup',
            record,
            run: () => liveSdk.get(params),
          }),
        getOrCreate: (params) =>
          measured({
            name: 'sandbox-mount',
            record,
            run: () => liveSdk.getOrCreate(params),
          }),
      },
      driveSdk: {
        getOrCreate: (params) =>
          measured({
            name: 'drive-get-or-create',
            record,
            run: () => liveDriveSdk.getOrCreate(params),
          }),
        list: async (params) => {
          const startedMs = performance.now()
          const listed = await liveDriveSdk.list(params)
          return {
            async *[Symbol.asyncIterator]() {
              let ok = false
              try {
                for await (const drive of listed) yield drive
                ok = true
              } finally {
                record({
                  phase: 'span',
                  name: 'drive-list',
                  startedMs,
                  elapsedMs: performance.now() - startedMs,
                  ok,
                })
              }
            },
          }
        },
      },
    })
    this.record = record
  }

  private readonly record: BenchmarkRecorder

  override createOrResume(args: Parameters<VercelDriver['createOrResume']>[0]) {
    const put = args.putContextOnFreshBoot
    return super.createOrResume({
      ...args,
      ...(put === undefined
        ? {}
        : {
            putContextOnFreshBoot: (sandbox) =>
              measured({
                name: 'bootstrap',
                record: this.record,
                run: () => put(sandbox),
              }),
          }),
    })
  }

  override async writeBootstrapFileToSandbox(
    args: Parameters<VercelDriver['writeBootstrapFileToSandbox']>[0],
  ) {
    this.record({
      phase: 'upload-size',
      name: basename(args.path),
      bytes: Buffer.byteLength(args.content),
    })
    return measured({
      name: `upload-${basename(args.path)}`,
      record: this.record,
      run: () => super.writeBootstrapFileToSandbox(args),
    })
  }

  override async uploadWorkspaceArchive(
    args: Parameters<VercelDriver['uploadWorkspaceArchive']>[0],
  ) {
    this.record({
      phase: 'upload-size',
      name: basename(args.destination),
      bytes: (await stat(args.source)).size,
    })
    return measured({
      name: `upload-${basename(args.destination)}`,
      record: this.record,
      run: () => super.uploadWorkspaceArchive(args),
    })
  }
}
