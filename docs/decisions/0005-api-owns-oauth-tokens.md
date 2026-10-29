# 0005. The API owns OAuth model tokens for every pod

Accepted 2026-10-19.

## Context

Subscription accounts (Claude, Codex) authenticate with OAuth. A refresh token copied into a pod
goes stale the moment either side rotates it, and a pod that refreshes on its own can invalidate
the copy everyone else holds.

## Decision

Atlas Cloud holds the refresh token. A pod leases short-lived access tokens with
the tRPC procedure `oauthConnections.accessToken`, and the API refreshes as needed
(`apps/api/src/api/platform/oauth-connections/oauth-connections.service.ts`). This applies to local
pods as well as Vercel ones. No token rides in the birth bundle: a pod starts with the access token
from its account lease at boot and leases a new one when that is stale or rejected
(`packages/harness/src/credentials/cloud-managed-credential-port.ts`).

## Why

One owner of the refresh token means rotation can't race, and a long session never loses its
credential halfway through.

## Consequences

- A local pod calls the API outbound and holds an authentication lease (`LocalPodLease`), but it
  has no `CloudSandbox` registration, so it never appears in the cloud listing.
- OAuth accounts in a pod need an Atlas Cloud sign-in.
- The account lease (`accountLease.get`) blanks OAuth refresh tokens.
- Pod birth relies on the API being up, accepted because it runs on Vercel.
