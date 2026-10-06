import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { WorkspaceFamilyCapture } from '../manifest'
import { createScratch, git } from './capture-fixture'

export { cleanupScratches, createScratch, git } from './capture-fixture'

export const MEMBERS = ['a', 'b', 'c', 'd', 'e'] as const
export type Member = (typeof MEMBERS)[number]

export type FamilyCheckout = { id: string; path: string; branch: string; keepsCache: boolean }

export type FamilyFixture = {
  scratch: string
  main: string
  unrelated: string
  nestedUnrelated: string
  checkouts: Record<Member, FamilyCheckout>
  family: WorkspaceFamilyCapture
}

const MARKER = 'atlas-checkout-id'
const CACHE_KEEPERS: readonly Member[] = ['a', 'c', 'e']

const dangling = async ({ cwd, label }: { cwd: string; label: string }): Promise<string> =>
  git({ args: ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', label], cwd })

async function dress({ checkout, member }: { checkout: FamilyCheckout; member: Member }): Promise<void> {
  const { path } = checkout
  await mkdir(join(path, 'pkg', 'sub'), { recursive: true })
  await writeFile(join(path, '.gitignore'), `skip-${member}.env\nkeep-${member}.cache\n`)
  await writeFile(join(path, `file-${member}.txt`), `committed ${member}\n`)
  await writeFile(join(path, 'pkg', 'sub', 'deep.txt'), `deep ${member}\n`)
  await git({ args: ['add', '-A'], cwd: path })
  await git({ args: ['commit', '-m', `commit ${member}`], cwd: path })
  if (member === 'b') {
    await writeFile(join(path, 'second-b.txt'), 'second\n')
    await git({ args: ['add', '-A'], cwd: path })
    await git({ args: ['commit', '-m', 'commit b2'], cwd: path })
  }
  await writeFile(join(path, 'README.md'), `edited in ${member}\n`)
  await writeFile(join(path, `staged-${member}.txt`), `staged ${member}\n`)
  await git({ args: ['add', `staged-${member}.txt`], cwd: path })
  await writeFile(join(path, `new-${member}.txt`), `untracked ${member}\n`)
  await writeFile(join(path, `skip-${member}.env`), 'never travels\n')
  await writeFile(join(path, `keep-${member}.cache`), 'travels only when included\n')
  if (checkout.keepsCache) {
    await mkdir(join(path, '.atlas'), { recursive: true })
    await writeFile(join(path, '.atlas', '.cloudinclude'), `keep-${member}.cache\n`)
  }
}

async function addCheckout({ scratch, main, member }: { scratch: string; main: string; member: Member }): Promise<FamilyCheckout> {
  const path = member === 'e' ? join(main, '.atlas', 'worktrees', 'wt-e') : join(scratch, `wt-${member}`)
  const checkout: FamilyCheckout = {
    id: `chk-${member}`,
    path,
    branch: `br-${member}`,
    keepsCache: CACHE_KEEPERS.includes(member),
  }
  await git({ args: ['worktree', 'add', path, '-b', checkout.branch], cwd: main })
  const gitDir = await git({ args: ['rev-parse', '--absolute-git-dir'], cwd: path })
  await writeFile(join(gitDir, MARKER), `${checkout.id}\n`)
  await dress({ checkout, member })
  return checkout
}

const threadFor = ({ member, checkout }: { member: Member; checkout: FamilyCheckout }) => ({
  threadId: `t-${member}`,
  home: member === 'c' ? join(checkout.path, 'pkg', 'sub') : checkout.path,
  active: { path: checkout.path, branch: checkout.branch, base: member === 'c' ? undefined : 'main', adopted: member === 'c' },
})

export async function createFamilyFixture(): Promise<FamilyFixture> {
  const scratch = await createScratch()
  const main = join(scratch, 'repo')
  await mkdir(main)
  await git({ args: ['init', '-b', 'main'], cwd: main })
  await writeFile(join(main, '.gitignore'), 'ignored-main.log\n.atlas/worktrees/\n')
  await writeFile(join(main, 'README.md'), 'hello\n')
  await git({ args: ['add', '.'], cwd: main })
  await git({ args: ['commit', '-m', 'initial'], cwd: main })

  const checkouts = {} as Record<Member, FamilyCheckout>
  for (const member of MEMBERS) checkouts[member] = await addCheckout({ scratch, main, member })

  await git({ args: ['update-ref', 'refs/bisect/bad', await dangling({ cwd: checkouts.b.path, label: 'dangling-b' })], cwd: checkouts.b.path })
  await git({ args: ['update-ref', 'refs/bisect/bad', await dangling({ cwd: checkouts.c.path, label: 'dangling-c' })], cwd: checkouts.c.path })
  await git({ args: ['update-ref', 'refs/worktree/note', await dangling({ cwd: checkouts.a.path, label: 'dangling-a' })], cwd: checkouts.a.path })
  await git({ args: ['update-ref', 'refs/bisect/main-bad', await dangling({ cwd: main, label: 'dangling-main' })], cwd: main })

  const unrelated = join(scratch, 'unrelated')
  await git({ args: ['worktree', 'add', unrelated, '-b', 'unrelated-branch'], cwd: main })
  await writeFile(join(unrelated, 'only-unrelated.txt'), 'unrelated\n')
  await git({ args: ['add', '-A'], cwd: unrelated })
  await git({ args: ['commit', '-m', 'unrelated work'], cwd: unrelated })
  await writeFile(join(unrelated, 'untracked-unrelated.txt'), 'dirty\n')
  const nestedUnrelated = join(main, '.atlas', 'worktrees', 'other')
  await git({ args: ['worktree', 'add', nestedUnrelated, '-b', 'nested-unrelated'], cwd: main })

  await writeFile(join(main, 'README.md'), 'hello, edited\n')
  await writeFile(join(main, 'staged-main.txt'), 'staged main\n')
  await git({ args: ['add', 'staged-main.txt'], cwd: main })
  await writeFile(join(main, 'new-main.txt'), 'untracked main\n')
  await writeFile(join(main, 'ignored-main.log'), 'ignored\n')

  const family: WorkspaceFamilyCapture = {
    rootId: 'root',
    checkouts: [
      ...MEMBERS.map((member) => ({ id: checkouts[member].id, path: checkouts[member].path, claimedBy: `t-${member}` })),
      { id: checkouts.a.id, path: checkouts.a.path, claimedBy: 't-a' },
    ],
    threads: [
      { threadId: 'root', home: main, active: null },
      ...MEMBERS.filter((member) => member !== 'd').map((member) => threadFor({ member, checkout: checkouts[member] })),
      { threadId: 't-d', home: main, active: null },
      { threadId: 't-a-again', home: checkouts.a.path, active: null },
    ],
  }
  return { scratch, main, unrelated, nestedUnrelated, checkouts, family }
}
