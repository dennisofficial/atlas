# 0006. A per-user SSH signing key replaces the GPG export

Accepted 2026-10-19.

## Context

Commits made in a pod should show as Verified on GitHub. The old path exported the operator's GPG
key into the sandbox (the since-deleted `gpg-material.ts` and the `sealedGpgKey` column), which
copied a personal key into every container and did not work on Vercel.

## Decision

Atlas generates an ed25519 key per user (`packages/harness/src/cloud/openssh-keygen.ts`) and the API
registers it on the user's GitHub account as an SSH signing key with `POST /user/ssh_signing_keys`
(`apps/api/src/api/cloud/ssh-signing-key/`). The private half is stored sealed in `SshSigningKey`
and leased to pods with `GET /v1/ssh-signing-key`. Serve writes it to `/atlas/home/ssh-signing-key`
and sets `gpg.format=ssh`, `user.signingkey`, `commit.gpgsign`, `tag.gpgsign`, the user's GitHub
name and email, and `gpg.ssh.allowedSignersFile` (`apps/serve/src/signing-key-env.ts`).

## Why

The user's own key never leaves their machine, and one mechanism works on both runners.

## Consequences

- The GitHub device flow asks for `admin:ssh_signing_key`
  (`apps/api/src/api/cloud/github/github-device-client.ts`), so rotate and revoke can delete the old
  key. Every user reconnected GitHub once.
- The GPG export and `sealedGpgKey` are deleted
  (`apps/api/prisma/migrations/20261020180000_drop_sealed_gpg_key`).
- If the lease fails, boot continues without installing the signing configuration.
