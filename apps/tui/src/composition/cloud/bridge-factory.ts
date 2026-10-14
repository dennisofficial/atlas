import type { CloudBridge } from '@dltech/atlas-harness'

export type CloudBridgeFactory = () => CloudBridge

/**
 * Answers the refusal to show, or null when the cloud birth may proceed. Missing Vercel
 * credentials must fail the moment a cloud thread is requested, not at the sandbox wait. A cloud
 * sign-in is never required — provisioning rides the operator's local Vercel credentials and
 * locally minted serve token.
 */
export type LiftPreflight = () => Promise<string | null>
