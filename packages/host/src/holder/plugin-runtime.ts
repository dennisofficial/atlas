import { PodRuntimeScope } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from './held-session-deps'
import { pluginCallOf } from './plugin-call'
import { fireLive, type SessionRuntime } from './ports'

export const pluginRuntimeOf = (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
}): PodRuntimeScope => {
  const { deps, runtime } = args
  if (runtime.pluginScope !== undefined) return runtime.pluginScope
  const scope = new PodRuntimeScope({
    call: pluginCallOf({
      invoke: (call) => runtime.remoteCalls.invoke(call),
      ...(runtime.workspaceGate === undefined ? {} : { gate: runtime.workspaceGate }),
      ack: (key) => runtime.remoteCalls.ack({ key }),
    }),
    live: (frame) => fireLive({ bus: deps.bus, key: deps.sessionId, frame }),
    log: (message) => deps.log?.info({ source: 'holder.plugin', message }),
    onDaemonEvent: (listener) => runtime.remoteCalls.onEvent(listener),
  })
  runtime.pluginScope = scope
  let bootId = runtime.remoteCalls.bootId()
  const offReady = runtime.remoteCalls.onReady((hello) => {
    if (bootId !== undefined && bootId !== hello.bootId) scope.reset()
    bootId = hello.bootId
  })
  const offClose = runtime.remoteCalls.onClose(() => scope.dispose())
  scope.shared((context) => {
    context.onDispose(offReady)
    context.onDispose(offClose)
  })
  return scope
}
