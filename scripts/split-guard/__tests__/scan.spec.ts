import { describe, expect, it } from 'bun:test'

import { judge, specifiersOf, violationsOf } from '../scan'
import { SPLIT_RULES } from '../rules'

const files = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries))

describe('specifiersOf', () => {
  it('reads static, dynamic, side-effect and require specifiers', () => {
    const text = [
      "import { a } from '@x/one'",
      "export * from '@x/two/sub'",
      "const b = await import('@x/three')",
      "import '@x/four'",
      "const c = require('@x/five')",
    ].join('\n')
    expect(specifiersOf(text)).toEqual(
      expect.arrayContaining(['@x/one', '@x/two/sub', '@x/three', '@x/four', '@x/five']),
    )
  })
})

describe('violationsOf', () => {
  it('flags v2 code importing v1 packages and subpaths', () => {
    const found = violationsOf({
      rules: SPLIT_RULES,
      files: files({
        'packages/agent/src/a.ts': "import { x } from '@dltech/atlas-wire/web'",
        'packages/host/src/b.ts': "import { y } from '@dltech/atlas-agent-v1'",
        'apps/daemon/src/c.ts': "import { z } from '@dltech/atlas-harness/titling'",
      }),
    })
    expect(found.map((violation) => violation.file)).toEqual([
      'packages/agent/src/a.ts',
      'packages/host/src/b.ts',
      'apps/daemon/src/c.ts',
    ])
  })

  it('flags v1 code importing v2 packages', () => {
    const found = violationsOf({
      rules: SPLIT_RULES,
      files: files({
        'packages/harness/src/a.ts': "import { x } from '@dltech/atlas-agent'",
        'apps/serve/src/b.ts': "import { y } from '@dltech/atlas-host'",
      }),
    })
    expect(found).toHaveLength(2)
  })

  it('allows each side its own packages and ignores lookalike names', () => {
    const found = violationsOf({
      rules: SPLIT_RULES,
      files: files({
        'packages/harness/src/a.ts': "import { x } from '@dltech/atlas-agent-v1'",
        'packages/agent/src/b.ts': "import { y } from '@dltech/atlas-core'",
        'packages/host/src/c.ts': "import { z } from '@dltech/atlas-agent'",
        'packages/agent-v1/src/d.ts': "import { w } from '@dltech/atlas-wire'",
        'packages/agent/src/e.ts': "import { v } from '@dltech/atlas-wirex'",
      }),
    })
    expect(found).toEqual([])
  })
})

describe('plugin isolation rule', () => {
  const found = (entries: Record<string, string>) =>
    violationsOf({ rules: SPLIT_RULES, files: files(entries) })

  it('flags a plugin importing another plugin by package name or path', () => {
    const result = found({
      'plugins/github/src/a.ts': "import { x } from '@dltech/atlas-plugin-shells/pod'",
      'plugins/github/src/b.ts': "import { y } from '../../shells/src/pod'",
      'plugins/github/src/c.ts': "import { z } from 'plugins/shells'",
    })
    expect(result.map((violation) => violation.file)).toEqual([
      'plugins/github/src/a.ts',
      'plugins/github/src/b.ts',
      'plugins/github/src/c.ts',
    ])
  })

  it('allows a plugin its own package, the sdk and foundation packages', () => {
    const result = found({
      'plugins/github/src/a.ts': "import { x } from '@dltech/atlas-plugin-github/core'",
      'plugins/github/src/b.ts': "import { y } from '@dltech/atlas-plugin-sdk'",
      'plugins/github/src/c.ts': "import { z } from '@dltech/atlas-core'",
      'apps/api/src/d.ts': "import { w } from '@dltech/atlas-plugin-shells/control'",
    })
    expect(result).toEqual([])
  })
})

describe('judge', () => {
  const violation = { file: 'a.ts', specifier: '@s', rule: 'r' }

  it('passes allowlisted violations and fails new ones', () => {
    const result = judge({
      violations: [violation, { ...violation, file: 'b.ts' }],
      allowlist: [{ file: 'a.ts', specifier: '@s' }],
    })
    expect(result.forbidden.map((entry) => entry.file)).toEqual(['b.ts'])
    expect(result.stale).toEqual([])
  })

  it('reports allowlist entries that no longer apply', () => {
    const result = judge({ violations: [], allowlist: [{ file: 'a.ts', specifier: '@s' }] })
    expect(result.stale).toEqual([{ file: 'a.ts', specifier: '@s' }])
  })
})
