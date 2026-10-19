import { z } from "zod";

export const websiteStatusSchema = z.enum(["ACTIVE", "DISABLED", "ARCHIVED"]);

export const createWebsiteSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      "Enter a valid domain without protocol (e.g. example.com)"
    ),
  url: z.string().url("Enter a valid URL (e.g. https://example.com)"),
  description: z.string().max(2000).optional().nullable(),
  niche: z.string().max(500).optional().nullable(),
  targetAudience: z.string().max(1000).optional().nullable(),
  primaryCountry: z.string().max(100).optional().nullable(),
  targetCountries: z.array(z.string()).optional().default([]),
  primaryLanguage: z.string().max(20).optional().default("en"),
  timezone: z.string().max(100).optional().default("UTC"),
  status: websiteStatusSchema.optional().default("ACTIVE"),
});

export const updateWebsiteSchema = createWebsiteSchema.partial();

export const settingsSchema = z.object({
  defaultPostType: z.string().max(100).optional().nullable(),
  defaultCategory: z.string().max(200).optional().nullable(),
  defaultTags: z.array(z.string()).optional().default([]),
  defaultAuthor: z.string().max(200).optional().nullable(),
  workflow: z.enum(["DRAFT_FIRST", "PUBLISH_DIRECT"]).optional().default("DRAFT_FIRST"),
  autoSeoMetadata: z.boolean().optional().default(true),
  dynamicTags: z.boolean().optional().default(true),
  imageInsertion: z.enum(["NONE", "MANUAL", "AUTO"]).optional().default("MANUAL"),
  researchEnabled: z.boolean().optional().default(true),
  minSources: z.number().int().min(0).max(100).optional().default(3),
  minEditorialScore: z.number().int().min(0).max(100).optional().nullable(),
  defaultArticleLanguage: z.string().max(20).optional().default("en"),
});

export const guidelinesSchema = z.object({
  brandVoice: z.string().max(5000).optional().nullable(),
  writingStyle: z.string().max(5000).optional().nullable(),
  spellingVariant: z.string().max(20).optional().nullable(),
  formalityLevel: z.string().max(50).optional().nullable(),
  targetReader: z.string().max(1000).optional().nullable(),
  readingComplexity: z.string().max(200).optional().nullable(),
  contentDepth: z.string().max(500).optional().nullable(),
  articleStructure: z.string().max(5000).optional().nullable(),
  introStyle: z.string().max(2000).optional().nullable(),
  avoidPhrases: z.array(z.string()).optional().default([]),
  verifyClaims: z.array(z.string()).optional().default([]),
  internalLinking: z.string().max(2000).optional().nullable(),
  externalLinking: z.string().max(2000).optional().nullable(),
  brandInstructions: z.string().max(5000).optional().nullable(),
  editorialChecklist: z.array(z.string()).optional().default([]),
  customInstructions: z.string().max(10000).optional().nullable(),
});

export const aiConfigSchema = z.object({
  preferredModel: z.string().max(200).optional().nullable(),
  fallbackModel: z.string().max(200).optional().nullable(),
  researchModel: z.string().max(200).optional().nullable(),
  writingModel: z.string().max(200).optional().nullable(),
  seoModel: z.string().max(200).optional().nullable(),
  maxOutputTokens: z.number().int().min(0).max(1_000_000).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  perTaskOverrides: z.record(z.string()).optional().default({}),
  monthlyBudgetCents: z.number().int().min(0).optional().nullable(),
  maxCostPerArticleCents: z.number().int().min(0).optional().nullable(),
  maxRetries: z.number().int().min(0).max(10).optional().default(2),
  // apiKey is handled separately (encrypted; never returned to browser)
  apiKey: z.string().max(500).optional().nullable(),
});

export const wordpressSchema = z.object({
  siteUrl: z
    .string()
    .url("Enter a valid WordPress site URL")
    .refine((v) => /^https:\/\//i.test(v), "WordPress connections require HTTPS"),
  username: z.string().min(1).max(200),
  appPassword: z.string().min(1).max(200),
});

export const credentialsSchema = z.object({
  openrouterApiKey: z.string().max(500).optional().nullable(),
  wordpressAppPassword: z.string().max(200).optional().nullable(),
});

export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type GuidelinesInput = z.infer<typeof guidelinesSchema>;
export type AiConfigInput = z.infer<typeof aiConfigSchema>;
export type WordpressInput = z.infer<typeof wordpressSchema>;
