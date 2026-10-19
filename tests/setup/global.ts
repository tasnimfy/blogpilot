// Runs once in a dedicated process before the test workers start.
// Pushes the Prisma schema into the test SQLite file and seeds a test admin.
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

export default async function setup() {
  process.env.DATABASE_URL = "file:./test.db";
  process.env.APP_ENC_KEY = "a".repeat(64);
  process.env.AUTH_SECRET = "test-secret-for-blogpilot-tests-1234567890";

  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
