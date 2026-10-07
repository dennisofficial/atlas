import { ELinkedCheckouts, linkedCheckoutsOf, pathExists, readCheckoutMarker } from './family-ownership-git'
import type { FamilyCheckout, FamilyOwnership } from './family-ownership-file'

export async function presentFamilyCheckouts({ ownership }: { ownership: FamilyOwnership }): Promise<FamilyOwnership['checkouts']> {
  if (ownership.checkouts.length === 0) return []
  const registered = await linkedCheckoutsOf({ primary: ownership.primaryRepository })
  if (registered.kind === ELinkedCheckouts.NotARepository) {
    throw new Error(`${ownership.primaryRepository} is no longer a git repository, so its family checkouts cannot be verified`)
  }
  const present: FamilyCheckout[] = []
  for (const checkout of ownership.checkouts) {
    const worktree = registered.linked.get(checkout.path)
    if (worktree === undefined || worktree.isPrunable) continue
    if (!(await pathExists({ path: checkout.path }))) continue
    if ((await readCheckoutMarker({ checkout: checkout.path })) !== checkout.id) continue
    present.push(checkout)
  }
  return present
}
