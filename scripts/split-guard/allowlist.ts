export const ALLOWLIST: readonly { file: string; specifier: string }[] = [
  {
    file: 'apps/agent-host/src/runtime/__tests__/session-runtime-factory.spec.ts',
    specifier: '@dltech/atlas-wire',
  },
  { file: 'apps/agent-host/src/runtime/foreground-shells.ts', specifier: '@dltech/atlas-harness' },
  { file: 'apps/agent-host/src/runtime/prompt.ts', specifier: '@dltech/atlas-harness' },
  {
    file: 'apps/agent-host/src/runtime/session-runtime-factory.ts',
    specifier: '@dltech/atlas-harness',
  },
  {
    file: 'apps/agent-host/src/runtime/session-runtime-factory.ts',
    specifier: '@dltech/atlas-wire',
  },
  { file: 'apps/agent-host/src/runtime/tools.ts', specifier: '@dltech/atlas-harness' },
  { file: 'apps/agent-host/src/runtime/workspace-clone.ts', specifier: '@dltech/atlas-wire' },
  {
    file: 'apps/agent-host/src/sandbox/__tests__/vercel-sandbox-provider.spec.ts',
    specifier: '@dltech/atlas-wire',
  },
  { file: 'apps/agent-host/src/sandbox/daemon-launch.ts', specifier: '@dltech/atlas-wire' },
  { file: 'apps/agent-host/src/sandbox/sandbox-provider.ts', specifier: '@dltech/atlas-wire' },
  {
    file: 'apps/agent-host/src/sandbox/vercel-sandbox-provider.ts',
    specifier: '@dltech/atlas-wire',
  },
  {
    file: 'apps/agent-host/src/testing/fixed-endpoint-sandbox-provider.ts',
    specifier: '@dltech/atlas-wire',
  },
  {
    file: 'apps/agent-host/src/testing/local-sandbox-provider.ts',
    specifier: '@dltech/atlas-wire',
  },
]
