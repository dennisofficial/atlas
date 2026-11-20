#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5e85d8cdcd62571cf9e061d2d249db49c7b6c39f6d336e6cb5e8b35a04d52b4b/contract';
import endContract from '../../snapshots/5e85d8cdcd62571cf9e061d2d249db49c7b6c39f6d336e6cb5e8b35a04d52b4b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/76eef62c5f7a890871af1fa51b0bb2ffd26177915dc65c8049fb3f48c52e8607/contract';
import startContract from '../../snapshots/76eef62c5f7a890871af1fa51b0bb2ffd26177915dc65c8049fb3f48c52e8607/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_pending_idx',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_liveUntil_idx',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_deadAt_idx',
      }),
      this.dropIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_processedAt_idx',
      }),
      this.dropIndex({
        schema: 'v2',
        table: 'V2SandboxRun',
        index: 'V2SandboxRun_sessionId_idx_29f415d4',
      }),
      this.dropIndex({
        schema: 'v2',
        table: 'V2SessionBranch',
        index: 'V2SessionBranch_sessionId_idx_29f415d4',
      }),
      this.dropIndex({
        schema: 'v2',
        table: 'V2Terminal',
        index: 'V2Terminal_sessionId_idx_29f415d4',
      }),
      this.dropNotNull({ schema: 'public', table: 'GithubWebhookInbox', column: 'payload' }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_parked_idx_420727ba',
        columns: ['parkedSince'],
        extras: {
          where: sql`("dispatchedAt" IS NULL AND "deadLetteredAt" IS NULL AND "parkedSince" IS NOT NULL)`,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_pending_idx_93d474b5',
        columns: ['createdAt'],
        extras: { where: sql`("dispatchedAt" IS NULL AND "deadLetteredAt" IS NULL)` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_retry_idx_ceb33cdb',
        columns: ['nextAttemptAt'],
        extras: {
          where: sql`("dispatchedAt" IS NULL AND "deadLetteredAt" IS NULL AND "nextAttemptAt" IS NOT NULL)`,
        },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_deadAt_idx_fcda36f6',
        columns: ['deadAt'],
        extras: { where: sql`("deadAt" IS NOT NULL)` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_due_idx_c3c7694b',
        columns: ['receivedAt'],
        extras: { where: sql`("processedAt" IS NULL AND "deadAt" IS NULL)` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_processedAt_idx_be4956e2',
        columns: ['processedAt'],
        extras: { where: sql`("processedAt" IS NOT NULL)` },
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Session',
        index: 'V2Session_mainThreadId_idx_60785a54',
        columns: ['mainThreadId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
