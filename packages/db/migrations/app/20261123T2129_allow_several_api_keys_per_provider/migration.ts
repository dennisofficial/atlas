#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract';
import endContract from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ec07878e1d08550f2bcb55b07c24a180003a9c896bb28f73b2bd9b67cd202325/contract';
import startContract from '../../snapshots/ec07878e1d08550f2bcb55b07c24a180003a9c896bb28f73b2bd9b67cd202325/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'AgentAccount',
        index: 'AgentAccount_api_key_per_provider_cc097a1d',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
