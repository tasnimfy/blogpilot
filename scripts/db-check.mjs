// Verifies the configured database is reachable (used by docker/entrypoint.sh).
// Exits non-zero so a broken DATABASE_URL fails the deploy instead of
// starting an app whose pages hang on the login screen.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database check: OK");
  await prisma.$disconnect();
} catch (e) {
  console.error("Database check: FAILED -");
  console.error(e instanceof Error ? e.message : String(e));
  console.error("Check the DATABASE_URL environment variable / volume mount.");
  process.exit(1);
}
