import type { ResearchProvider, ResearchQuery, ResearchResponse } from "@/providers/types";

// Manual research provider: no automated search. It honestly reports that no
// search provider is configured rather than fabricating results. The operator
// adds sources manually (the manual fallback is always available).
class ManualResearchProvider implements ResearchProvider {
  readonly id = "manual";
  readonly name = "Manual sources";
  readonly capabilities =
    "No automated search provider is configured. Add sources and findings manually through the API. " +
    "Respects platform terms and robots directives by not scraping."

  async search(_q: ResearchQuery): Promise<ResearchResponse> {
    return {
      ok: false,
      error:
        "No automated research search provider is configured or verified. " +
        "Add sources manually, or configure an authorized search provider in a later phase.",
    };
  }
}

const registry = new Map<string, ResearchProvider>();
register(new ManualResearchProvider());

export function register(provider: ResearchProvider): void {
  registry.set(provider.id, provider);
}

export function getResearchProvider(id?: string | null): ResearchProvider {
  return registry.get(id ?? "") ?? registry.get("manual")!;
}

export function listResearchProviders(): ResearchProvider[] {
  return [...registry.values()];
}
