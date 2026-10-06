import { EWorktreeExit, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import type { SessionRegistry } from '../store/sessions/registry'
import { canonicalPath, claimCheckoutMarker, linkedCheckoutsOf, registeredPrimaryOf, toplevelOf, type LinkedCheckouts } from './family-ownership-git'
import { writeFamilyOwnership, type FamilyCheckout, type FamilyOwnership } from './family-ownership-file'
import { ensureFamilyOwnership } from './family-ownership-seed'

type Step = { kind: 'claim'; path: string } | { kind: 'adopt'; path: string } | { kind: 'drop'; path: string }

async function primaryCheckoutOf({ ownership, path }: { ownership: FamilyOwnership; path: string }): Promise<string | null> {
  const checkout = await toplevelOf({ path })
  if (checkout === null) return null
  return (await registeredPrimaryOf({ checkout })) === ownership.primaryRepository ? checkout : null
}

async function stepsOf({ drafts, ownership }: { drafts: readonly EventDraft[]; ownership: FamilyOwnership }): Promise<Step[]> {
  const steps: Step[] = []
  for (const draft of drafts) {
    if (draft.type === 'worktree-entered') steps.push({ kind: 'claim', path: await canonicalPath(draft.path) })
    if (draft.type === 'directory-changed') {
      const checkout = await primaryCheckoutOf({ ownership, path: draft.path })
      if (checkout !== null) steps.push({ kind: 'adopt', path: checkout })
    }
    if (draft.type === 'worktree-exited' && draft.action === EWorktreeExit.Remove) steps.push({ kind: 'drop', path: await canonicalPath(draft.path) })
  }
  return steps
}

async function claimEntered({
  checkouts,
  path,
  claimedBy,
}: {
  checkouts: FamilyCheckout[]
  path: string
  claimedBy: string
}): Promise<FamilyCheckout[]> {
  const id = await claimCheckoutMarker({ checkout: path })
  const previous = checkouts.find((checkout) => checkout.path === path)
  const next: FamilyCheckout = { id, path, claimedBy: previous?.id === id ? previous.claimedBy : claimedBy }
  return previous === undefined ? [...checkouts, next] : checkouts.map((checkout) => (checkout === previous ? next : checkout))
}

async function applyStep({
  checkouts,
  step,
  registered,
  claimedBy,
}: {
  checkouts: FamilyCheckout[]
  step: Step
  registered: LinkedCheckouts | undefined
  claimedBy: string
}): Promise<FamilyCheckout[]> {
  if (step.kind === 'drop') return checkouts.filter((checkout) => checkout.path !== step.path)
  if (registered?.kind !== 'repository' || !registered.linked.has(step.path)) return checkouts
  if (step.kind === 'adopt' && checkouts.some((checkout) => checkout.path === step.path)) return checkouts
  return claimEntered({ checkouts, path: step.path, claimedBy })
}

async function unownedLaunchStep({
  ownership,
  workspace,
}: {
  ownership: FamilyOwnership
  workspace: string | null
}): Promise<Step | null> {
  if (workspace === null) return null
  if (workspace === ownership.primaryRepository || ownership.checkouts.some((checkout) => checkout.path === workspace)) return null
  const path = await primaryCheckoutOf({ ownership, path: workspace })
  if (path === null || path === ownership.primaryRepository) return null
  if (ownership.checkouts.some((checkout) => checkout.path === path)) return null
  return { kind: 'adopt', path }
}

export async function trackFamilyOwnership({
  sessionDir,
  registry,
  threadId,
  drafts,
  workspace,
}: {
  sessionDir: string
  registry: SessionRegistry
  threadId: ThreadId
  drafts: readonly EventDraft[]
  workspace: string | null
}): Promise<void> {
  const ownership = await ensureFamilyOwnership({ sessionDir, registry })
  if (ownership === null) return

  const launch = await unownedLaunchStep({ ownership, workspace })
  const steps = [...(launch === null ? [] : [launch]), ...(await stepsOf({ drafts, ownership }))]
  if (steps.length === 0) return

  const registered = steps.some((step) => step.kind !== 'drop') ? await linkedCheckoutsOf({ primary: ownership.primaryRepository }) : undefined
  let checkouts = ownership.checkouts
  for (const step of steps) checkouts = await applyStep({ checkouts, step, registered, claimedBy: threadId })
  if (sameCheckouts({ a: checkouts, b: ownership.checkouts })) return
  await writeFamilyOwnership({ sessionDir, ownership: { ...ownership, checkouts } })
}

function sameCheckouts({ a, b }: { a: readonly FamilyCheckout[]; b: readonly FamilyCheckout[] }): boolean {
  return a.length === b.length && a.every((checkout, index) => JSON.stringify(checkout) === JSON.stringify(b[index]))
}
