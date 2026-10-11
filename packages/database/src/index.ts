import { Pool, type PoolConfig } from 'pg';

export {
  createOwnerBootstrapToken,
  type OwnerBootstrapClient,
  type OwnerBootstrapToken,
} from './owner-bootstrap.ts';

export interface DatabaseConnection {
  close(): Promise<void>;
  healthCheck(): Promise<void>;
  pool: Pool;
}

export function createDatabase(connectionString: string): DatabaseConnection {
  const options: PoolConfig = {
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    max: 10,
    statement_timeout: 10_000,
  };
  const pool = new Pool(options);
  return {
    async close() {
      await pool.end();
    },
    async healthCheck() {
      const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      if (result.rows[0]?.ok !== 1)
        throw new Error('database health check returned an invalid result');
    },
    pool,
  };
}
