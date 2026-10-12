export interface TenantTransactionClient {
  query(query: string, values?: unknown[]): Promise<unknown>;
}

export interface TenantTransactionPool {
  connect(): Promise<TenantTransactionClient & { release(): void }>;
}

export async function withTenantTransaction<T>(
  pool: TenantTransactionPool,
  context: { siteId: string; tenantId: string; userId: string },
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_app');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [context.tenantId]);
    await client.query(`SELECT set_config('app.site_id', $1, true)`, [context.siteId]);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [context.userId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withPlatformTransaction<T>(
  pool: TenantTransactionPool,
  context: { actorId: string },
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_platform');
    await client.query(`SELECT set_config('app.platform_actor_id', $1, true)`, [context.actorId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withAuthTransaction<T>(
  pool: TenantTransactionPool,
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_auth');
    await client.query(`SELECT set_config('app.authentication_contract_version', '3', true)`);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withWorkerTransaction<T>(
  pool: TenantTransactionPool,
  context: { jobId: string; siteId: string; tenantId: string },
  operation: (client: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE omnireach_worker');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [context.tenantId]);
    await client.query(`SELECT set_config('app.site_id', $1, true)`, [context.siteId]);
    await client.query(`SELECT set_config('app.job_id', $1, true)`, [context.jobId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
