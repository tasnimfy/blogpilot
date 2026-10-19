// Runs in each test worker before test files, so the singleton PrismaClient
// and cached env() see the test database.
process.env.DATABASE_URL = "file:./test.db";
process.env.APP_ENC_KEY = "a".repeat(64);
process.env.AUTH_SECRET = "test-secret-for-blogpilot-tests-1234567890";
