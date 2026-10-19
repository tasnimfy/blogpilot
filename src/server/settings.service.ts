import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { toJsonString } from "@/lib/json";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { z } from "zod";
import {
  settingsSchema,
  guidelinesSchema,
  aiConfigSchema,
  wordpressSchema,
  type SettingsInput,
  type GuidelinesInput,
  type AiConfigInput,
  type WordpressInput,
} from "@/lib/validation";

export class SettingsServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsServiceError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    throw new SettingsServiceError(res.error.issues[0]?.message ?? "Validation failed");
  }
  return res.data;
}

async function requireSite(websiteId: string) {
  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  if (!site) throw new SettingsServiceError("Website not found");
  return site;
}

// --- Settings -------------------------------------------------------------

export async function updateSettings(websiteId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const data = parseOrThrow(settingsSchema, input);
  const existing = await prisma.websiteSettings.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId },
  });
  const updated = await prisma.websiteSettings.update({
    where: { id: existing.id },
    data: {
      defaultPostType: data.defaultPostType ?? null,
      defaultCategory: data.defaultCategory ?? null,
      defaultTags: toJsonString(data.defaultTags ?? []),
      defaultAuthor: data.defaultAuthor ?? null,
      workflow: data.workflow ?? "DRAFT_FIRST",
      autoSeoMetadata: data.autoSeoMetadata ?? true,
      dynamicTags: data.dynamicTags ?? true,
      imageInsertion: data.imageInsertion ?? "MANUAL",
      researchEnabled: data.researchEnabled ?? true,
      minSources: data.minSources ?? 3,
      minEditorialScore: data.minEditorialScore ?? null,
      defaultArticleLanguage: data.defaultArticleLanguage ?? "en",
    },
  });
  await auditLog({
    userId,
    websiteId,
    action: "SETTINGS_UPDATED",
    entity: "WebsiteSettings",
    entityId: websiteId,
  });
  return updated;
}

// --- Editorial guidelines -------------------------------------------------

export async function updateGuidelines(websiteId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const data = parseOrThrow(guidelinesSchema, input);
  const existing = await prisma.editorialGuidelines.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId },
  });
  const updated = await prisma.editorialGuidelines.update({
    where: { id: existing.id },
    data: {
      brandVoice: data.brandVoice ?? null,
      writingStyle: data.writingStyle ?? null,
      spellingVariant: data.spellingVariant ?? null,
      formalityLevel: data.formalityLevel ?? null,
      targetReader: data.targetReader ?? null,
      readingComplexity: data.readingComplexity ?? null,
      contentDepth: data.contentDepth ?? null,
      articleStructure: data.articleStructure ?? null,
      introStyle: data.introStyle ?? null,
      avoidPhrases: toJsonString(data.avoidPhrases ?? []),
      verifyClaims: toJsonString(data.verifyClaims ?? []),
      internalLinking: data.internalLinking ?? null,
      externalLinking: data.externalLinking ?? null,
      brandInstructions: data.brandInstructions ?? null,
      editorialChecklist: toJsonString(data.editorialChecklist ?? []),
      customInstructions: data.customInstructions ?? null,
    },
  });
  await auditLog({
    userId,
    websiteId,
    action: "GUIDELINES_UPDATED",
    entity: "EditorialGuidelines",
    entityId: websiteId,
  });
  return updated;
}

// --- AI provider configuration -------------------------------------------

export async function updateAiConfig(
  websiteId: string,
  input: unknown,
  userId: string,
  openrouterGlobalKey?: string | null
) {
  await requireSite(websiteId);
  const data = parseOrThrow(aiConfigSchema, input);
  const existing = await prisma.aIProviderConfiguration.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId },
  });

  // Encrypt a newly submitted API key. An empty/blank key means "clear it".
  let apiKeyEncrypted = existing.apiKeyEncrypted;
  if (data.apiKey !== undefined) {
    if (data.apiKey && data.apiKey.trim().length > 0) {
      apiKeyEncrypted = encryptSecret(data.apiKey.trim());
    } else {
      apiKeyEncrypted = null;
    }
  }
  if (!apiKeyEncrypted && openrouterGlobalKey) {
    apiKeyEncrypted = encryptSecret(openrouterGlobalKey);
  }

  const updated = await prisma.aIProviderConfiguration.update({
    where: { id: existing.id },
    data: {
      apiKeyEncrypted,
      preferredModel: data.preferredModel ?? null,
      fallbackModel: data.fallbackModel ?? null,
      researchModel: data.researchModel ?? null,
      writingModel: data.writingModel ?? null,
      seoModel: data.seoModel ?? null,
      maxOutputTokens: data.maxOutputTokens ?? null,
      temperature: data.temperature ?? null,
      perTaskOverrides: toJsonString(data.perTaskOverrides ?? {}),
      monthlyBudgetCents: data.monthlyBudgetCents ?? null,
      maxCostPerArticleCents: data.maxCostPerArticleCents ?? null,
      maxRetries: data.maxRetries ?? 2,
    },
  });
  await auditLog({
    userId,
    websiteId,
    action: "AI_CONFIG_UPDATED",
    entity: "AIProviderConfiguration",
    entityId: websiteId,
  });
  return updated;
}

// --- WordPress connection -------------------------------------------------

export async function updateWordpress(websiteId: string, input: unknown, userId: string) {
  await requireSite(websiteId);
  const data = parseOrThrow(wordpressSchema, input);
  const existing = await prisma.wordPressConnection.upsert({
    where: { websiteId },
    update: {},
    create: { websiteId, siteUrl: data.siteUrl.trim(), username: data.username.trim() },
  });
  const updated = await prisma.wordPressConnection.update({
    where: { id: existing.id },
    data: {
      siteUrl: data.siteUrl.trim(),
      username: data.username.trim(),
      appPasswordEncrypted: encryptSecret(data.appPassword),
      status: "UNKNOWN",
      lastError: null,
    },
  });
  await auditLog({
    userId,
    websiteId,
    action: "WORDPRESS_CONNECTION_UPDATED",
    entity: "WordPressConnection",
    entityId: websiteId,
  });
  return updated;
}

// --- Serialization helpers (never leak secrets to the browser) -----------

// Returns a safe representation of the AI config with secrets redacted.
export function serializeAiConfig(row: { apiKeyEncrypted: string | null; [k: string]: unknown }) {
  const { apiKeyEncrypted, ...rest } = row;
  return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}

export function serializeWordpress(row: {
  appPasswordEncrypted: string | null;
  [k: string]: unknown;
}) {
  const { appPasswordEncrypted, ...rest } = row;
  return { ...rest, hasAppPassword: Boolean(appPasswordEncrypted) };
}

// Server-side helper to read a site's decrypted OpenRouter key (never returned to client).
export async function getDecryptedOpenRouterKey(websiteId: string): Promise<string | null> {
  const config = await prisma.aIProviderConfiguration.findUnique({ where: { websiteId } });
  if (!config?.apiKeyEncrypted) return null;
  try {
    return decryptSecret(config.apiKeyEncrypted);
  } catch {
    return null;
  }
}

export async function getDecryptedWordpressPassword(websiteId: string): Promise<string | null> {
  const conn = await prisma.wordPressConnection.findUnique({ where: { websiteId } });
  if (!conn?.appPasswordEncrypted) return null;
  try {
    return decryptSecret(conn.appPasswordEncrypted);
  } catch {
    return null;
  }
}
