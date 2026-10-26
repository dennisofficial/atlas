import { describe, expect, it } from 'bun:test'

import { EChangeStatus, EDiffLineKind } from '@dltech/atlas-wire'

import { MAX_LINES_PER_FILE, parseUnifiedDiff } from '../parse-unified-diff'

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 keep
-old
+new
 tail
`

describe('parseUnifiedDiff', () => {
  it('counts additions and deletions and numbers each line', () => {
    const [file] = parseUnifiedDiff(MODIFIED)

    expect(file).toMatchObject({
      path: 'src/a.ts',
      status: EChangeStatus.Modified,
      additions: 1,
      deletions: 1,
    })
    expect(file?.hunks[0]?.header).toBe('@@ -1,3 +1,3 @@')
    expect(file?.hunks[0]?.lines).toEqual([
      { kind: EDiffLineKind.Context, text: 'keep', oldNumber: 1, newNumber: 1 },
      { kind: EDiffLineKind.Remove, text: 'old', oldNumber: 2 },
      { kind: EDiffLineKind.Add, text: 'new', newNumber: 2 },
      { kind: EDiffLineKind.Context, text: 'tail', oldNumber: 3, newNumber: 3 },
    ])
  })

  it('reads added, deleted and renamed files', () => {
    const files = parseUnifiedDiff(`diff --git a/n.ts b/n.ts
new file mode 100644
--- /dev/null
+++ b/n.ts
@@ -0,0 +1 @@
+x
diff --git a/d.ts b/d.ts
deleted file mode 100644
--- a/d.ts
+++ /dev/null
@@ -1 +0,0 @@
-y
diff --git a/from.ts b/to.ts
similarity index 100%
rename from from.ts
rename to to.ts
`)

    expect(files.map((file) => file.status)).toEqual([
      EChangeStatus.Added,
      EChangeStatus.Deleted,
      EChangeStatus.Modified,
    ])
    expect(files[2]).toMatchObject({ path: 'to.ts', oldPath: 'from.ts' })
  })

  it('flags binary files and keeps no hunks', () => {
    const [file] = parseUnifiedDiff(`diff --git a/i.png b/i.png
index 1..2 100644
Binary files a/i.png and b/i.png differ
`)

    expect(file).toMatchObject({ binary: true, hunks: [] })
  })

  it('keeps counting past the per-file line cap but drops the lines', () => {
    const body = Array.from({ length: MAX_LINES_PER_FILE + 5 }, (_, i) => `+l${i}`).join('\n')
    const [file] = parseUnifiedDiff(
      `diff --git a/big b/big\nnew file mode 100644\n--- /dev/null\n+++ b/big\n@@ -0,0 +1,${MAX_LINES_PER_FILE + 5} @@\n${body}\n`,
    )

    expect(file?.additions).toBe(MAX_LINES_PER_FILE + 5)
    expect(file?.truncated).toBe(true)
    expect(file?.hunks[0]?.lines).toHaveLength(MAX_LINES_PER_FILE)
  })
})
