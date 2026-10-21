# 0010. A pod's workspace comes from a Project, found by the origin remote

Accepted 2026-10-20.

## Context

A pod used to clone whatever `git remote get-url origin` returned, on its default branch, with the
laptop's `gh auth token` written into the bootstrap. That tied the pod to local git state and
pushed a credential from the laptop. The web app has no launch directory at all.

## Decision

A **Project** is a cloud record: GitHub repo, base branch and additional repos (`Project` in
`apps/api/prisma/schema.prisma`, CRUD under `/v1/projects`). At birth the TUI matches the launch
directory's `origin` remote to one of the user's Projects. A GitHub remote with no match gets a
prompt to create one, prefilled. No remote gets a picker that includes No workspace. The bootstrap's
only input is the `projectId`; serve pulls the rest from `GET /v1/projects/:projectId/workspace`,
which also brokers the clone token from the user's GitHub connection.

## Why

The Project is the unit the web app can use too, and the clone credential stays in the cloud.

## Consequences

- The `projectId` is stamped into the thread meta, and wake reuses it.
- A pod may read any Project its owner has; there is no thread-to-Project binding.
- A failed extra-repo clone fails the whole workspace.
- The client-pushed `gh auth token` is deleted.
