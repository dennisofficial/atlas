# local-mix-v2c

51 sanitized scopes: the 48 cases of `local-mix-v2b`, unchanged, plus 3 cases for the
framework-shape exception in the single-responsibility policy.

## Added cases (v2b → v2c)

| Case id                                                | Shape                                                                                                                                                                                                                                                                                                                                                           | Expected                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `framework-shape-20261125T0037-ownership-dns-only`     | A database migration class: `up` creates a table and index, adds a column, backfills rows with per-row normalisation in TypeScript, then enforces the new column; `down` reverses it. The migration framework fixes this shape and every member serves the one migration. Generalised from a real false positive (2026-11-25, concern 0.85, impact introduced). | `unchanged`, no concern, no evidence                   |
| `framework-shape-20261110T1042-ownership-invites-mail` | The same migration shape, plus `inviteRecordedOwners` that sends outbound mail through a `Mailer`. Near-miss positive.                                                                                                                                                                                                                                          | `introduced`, concern, evidence `inviteRecordedOwners` |
| `framework-shape-20261118T1601-seat-plans-billing`     | The same migration shape, plus `createBillingPlans` that posts to a third-party billing API and parses its response. Near-miss positive.                                                                                                                                                                                                                        | `introduced`, concern, evidence `createBillingPlans`   |

The added cases are synthetic, with a `synthetic:framework-shape-2026-11-25` namespace and
`provenance.method` `synthetic_from_real_false_positive` or `synthetic_near_miss_positive`. They are
labelled from the rubric before any classifier call for them, and their verification is recorded as
`s6-drafter` — rubric-drafted, pending an independent blind review. They are not real-session
volume.

The label correction notes in `local-mix-v2b/README.md` still apply to the 48 carried cases.

This is a development pilot, not calibrated, and does not justify enabling the feature.
