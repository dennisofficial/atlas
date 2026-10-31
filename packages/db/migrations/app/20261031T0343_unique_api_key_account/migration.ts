#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/06b0868cd9f1f9bab0fb176034cd5d996206647b20d9c30172a3c44e53c98595/contract';
import endContract from '../../snapshots/06b0868cd9f1f9bab0fb176034cd5d996206647b20d9c30172a3c44e53c98595/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/4b5d5fb3abed299fe965f5bf71317327a7c4b3efd12ffb9627bd08d3946a8be9/contract';
import startContract from '../../snapshots/4b5d5fb3abed299fe965f5bf71317327a7c4b3efd12ffb9627bd08d3946a8be9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';
import { dedupeApiKeyAccounts } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      dedupeApiKeyAccounts,
      this.createIndex({
        schema: 'public',
        table: 'AgentAccount',
        index: 'AgentAccount_api_key_per_provider_cc097a1d',
        columns: ['userId', 'provider'],
        extras: { where: sql`("kind" = 'api-key')`, unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
