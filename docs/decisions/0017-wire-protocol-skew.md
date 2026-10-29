# 0017. The newer side talks down: the wire protocol tolerates skew

Accepted 2026-10-29.

## Context

The API and web deploy on every merge; a sandbox runs the serve of the release it booted with, and
keeps running it until it parks or rotates. #1499 bumped `CHANNEL_PROTOCOL_VERSION` 29 → 30 to add
one request (`revoke-grant`). Serve admitted only an exact protocol match, so from the API deploy
until each sandbox restarted, every message to a running sandbox was refused and the API answered
a generic 502.

## Decision

- **Additive changes do not bump the protocol.** A new request, frame field or enum value ships as
  a capability (`packages/wire/src/capabilities.ts`). Serve advertises it on Ready; clients gate
  the feature on it (`useServeSupports` in web). Unknown capabilities are dropped, never a decode
  failure.
- **Peers speak a range.** Hello and Ready carry `protocol` (newest) and `minProtocol` (oldest
  still spoken). `protocolSkewOf` admits any peer whose range overlaps ours. A bump keeps the
  previous protocol as `CHANNEL_PROTOCOL_MIN_VERSION` until no sandbox can still run it, and the
  newer side keeps speaking it.
- **Unknown requests fail alone.** A request frame serve cannot read gets a refused reply for its
  id; the socket stays open.
- **Recovery when skew still bites.** When serve refuses the protocol, the API parks the sandbox,
  keeps the message and relaunches it on the current serve instead of answering 502.
- **CI enforces it.** `scripts/check-wire-skew.ts`, run by the root `lint` script against the PR base, fails a change whose minimum drops the protocol
  the base spoke, a bump of more than one, or a removed frame/request without a bump.

## Why

The old side of this seam is a binary already running somewhere we cannot reach. Only the newer
side can adapt, so compatibility is its job — the Kubernetes version-skew policy, protobuf's
additive-field rules and LSP's capability exchange all land on the same shape.
