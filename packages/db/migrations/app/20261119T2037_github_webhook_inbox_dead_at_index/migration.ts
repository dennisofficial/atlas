#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/41338d269aeb2c3286bf5cd9de9bee50a6368aa813f7ccb5064f009c55f0d340/contract';
import startContract from '../../snapshots/41338d269aeb2c3286bf5cd9de9bee50a6368aa813f7ccb5064f009c55f0d340/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bf5971f6734312e26cc52170b6a19be6f0e0f24f0f9d6274f56906d2fc21bb93/contract';
import endContract from '../../snapshots/bf5971f6734312e26cc52170b6a19be6f0e0f24f0f9d6274f56906d2fc21bb93/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_deadAt_idx',
        columns: ['deadAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
