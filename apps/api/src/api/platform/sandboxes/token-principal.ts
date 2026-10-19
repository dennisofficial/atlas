import type { SandboxPrincipal } from './rows'

export enum ETokenPrincipalKind {
  Sandbox = 'sandbox',
  Pod = 'pod',
}

export type TokenPrincipal =
  | ({ kind: ETokenPrincipalKind.Sandbox } & SandboxPrincipal)
  | { kind: ETokenPrincipalKind.Pod; threadId: string; userId: string }
