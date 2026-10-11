import { createDatabase } from './index.ts';
import { createOwnerBootstrapToken } from './owner-bootstrap.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const database = createDatabase(databaseUrl);
try {
  const client = await database.pool.connect();
  try {
    const bootstrap = await createOwnerBootstrapToken(client);
    process.stdout.write(
      `Owner bootstrap token (shown once; expires ${bootstrap.expiresAt.toISOString()}):\n${bootstrap.token}\n`,
    );
  } finally {
    client.release();
  }
} finally {
  await database.close();
}
