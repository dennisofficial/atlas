import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import { CLOUDFLARED_PATH, PREVIEW_READY_TIMEOUT_MS, type DaemonOpsDeps } from '../deps'
import { TunnelSupervisor } from './tunnel-supervisor'
import { tokenFileOf } from './tunnel-token'

export const previewsGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => {
    const log = (line: string): void => console.error(line)
    const supervisor = new TunnelSupervisor({
      binary: deps.cloudflaredPath ?? CLOUDFLARED_PATH,
      env: deps.env,
      file: deps.previewsFile ?? tokenFileOf(deps.home),
      readyTimeoutMs: deps.previewReadyTimeoutMs ?? PREVIEW_READY_TIMEOUT_MS,
      ...(deps.previewHeartbeatMs === undefined ? {} : { heartbeatMs: deps.previewHeartbeatMs }),
      ...(deps.previewSuspendGapMs === undefined ? {} : { suspendGapMs: deps.previewSuspendGapMs }),
      log,
    })
    if (supervisor.storedToken() !== undefined) {
      void supervisor
        .start()
        .catch((error: unknown) =>
          log(
            `previews: the tunnel did not come up from the token in the pod: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        )
    }

    return {
      name: 'previews',
      ops: [
        defineOp({ op: 'previews.ensure', run: ({ op }) => supervisor.start(op.tunnelToken) }),
        defineOp({ op: 'previews.status', run: () => Promise.resolve(supervisor.status()) }),
      ],
      stop: () => supervisor.stop(),
    }
  }
