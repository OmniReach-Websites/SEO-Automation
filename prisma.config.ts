import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  migrations: {
    path: 'packages/database/prisma/migrations',
  },
  schema: 'packages/database/prisma/schema.prisma',
});
