#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/682b49388e4e1247af1b52d9cc6a6d082ff410b7332e8da6a8a03c52fb702ee4/contract';
import startContract from '../../snapshots/682b49388e4e1247af1b52d9cc6a6d082ff410b7332e8da6a8a03c52fb702ee4/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a1f6bd3f6d5954509850c76a50edbf8fed7bbc538a59236914fccf34eb806f5b/contract';
import endContract from '../../snapshots/a1f6bd3f6d5954509850c76a50edbf8fed7bbc538a59236914fccf34eb806f5b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'GithubPrState',
        index: 'GithubPrState_baseBranch_state_idx_75f326d8',
        columns: ['baseBranch', 'state'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Lease',
        index: 'Lease_holderHostId_sessionId_idx_68a338dc',
        columns: ['holderHostId', 'sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'SandboxRun',
        index: 'SandboxRun_sandboxInstanceId_startedAt_idx_8bf7e1f3',
        columns: ['sandboxInstanceId', 'startedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Session',
        index: 'Session_live_createdAt_id_f55f07d2',
        columns: ['createdAt', 'id'],
        extras: { where: sql`("archivedAt" IS NULL)` },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
