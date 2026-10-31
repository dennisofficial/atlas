import { z } from 'zod'

/**
 * The capabilities a greet (Hello / Ready) or health payload can advertise. A peer that predates
 * negotiation sends no capability set, and every capability reads as a typed absence — never a
 * schema failure. Additive: new members are safe to add because old binaries strip unknown
 * values, and the channel protocol version is NOT bumped for a capability (the version stays for
 * breaking frame-shape changes).
 */
export enum ECapability {
  /**
   * The serve can confirm safe rotation preparation (drain handshake). First shipped with the
   * `rotationPreparationVersion: 1` health field (#1025); the capability replaces the version
   * field as the presence signal.
   */
  RotationPreparation = 'rotation-preparation',
  /**
   * The serve's health payload identifies its sandbox session (`sandboxSessionId`). First shipped
   * with that field (#1025); the capability marks the field's presence.
   */
  SandboxSessionIdentity = 'sandbox-session-identity',
  CommandList = 'command-list',
  /** The serve reads a dismiss-failure frame; an older serve refuses an unknown frame by closing the socket, so clients gate on this. */
  DismissFailure = 'dismiss-failure',
  ReadActivity = 'read-activity',
}

export const capabilitySchema = z.enum(ECapability)

const knownCapabilityOf = (value: unknown): value is ECapability =>
  capabilitySchema.safeParse(value).success

/** Drops values this build does not know, so a newer peer's capability never fails the frame. */
export const capabilitiesSchema = z
  .array(z.unknown())
  .transform((values) => values.filter(knownCapabilityOf))
  .readonly()

export type CapabilitySet = ReadonlySet<ECapability>

export const capabilitySetOf = (advertised: readonly ECapability[] | undefined): CapabilitySet =>
  new Set(advertised ?? [])

export const supports = (args: { capabilities: CapabilitySet; capability: ECapability }): boolean =>
  args.capabilities.has(args.capability)

/** The full set a current serve advertises — every capability this build implements. */
export const SERVE_CAPABILITIES: readonly ECapability[] = [
  ECapability.RotationPreparation,
  ECapability.SandboxSessionIdentity,
  ECapability.CommandList,
  ECapability.DismissFailure,
  ECapability.ReadActivity,
]
