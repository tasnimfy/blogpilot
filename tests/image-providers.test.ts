import { describe, it, expect, afterEach } from "vitest";
import { OpenverseProvider, WikimediaProvider } from "@/providers/image-providers";

const realFetch = globalThis.fetch;
function stubFetch(res: Response | (() => Promise<Response>)) {
  globalThis.fetch = (() => Promise.resolve(typeof res === "function" ? (res as () => Promise<Response>)() : res)) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("image providers (mocked fetch)", () => {
  it("Openverse normalizes results with license/attribution and commercial flag", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "ov-1",
              title: "Rafting photo",
              url: "https://api.openverse.org/1.jpg",
              thumbnail: "https://api.openverse.org/thumb/1.jpg",
              creator: "Jane Doe",
              license: "cc0",
              license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
              attribution: "Photo by Jane Doe, CC0",
              width: 800,
              height: 600,
              mime_type: "image/jpeg",
              foreign_landing_url: "https://openverse.org/image/ov-1",
            },
          ],
        })
      )
    );
    const res = await new OpenverseProvider().search({ query: "rafting" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0].license).toBe("cc0");
    expect(res.items[0].commercialUse).toBe(true);
    expect(res.items[0].attributionRequired).toBe(false);
    expect(res.items[0].url).toBe("https://api.openverse.org/1.jpg");
  });

  it("Openverse reports an honest error instead of fabricating results", async () => {
    stubFetch(new Response("nope", { status: 500 }));
    const res = await new OpenverseProvider().search({ query: "rafting" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Openverse");
  });

  it("Wikimedia normalizes license/artist/commercial and attribution", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Whitewater Rafting.jpg",
                imageinfo: [
                  {
                    url: "https://upload.wikimedia.org/x.jpg",
                    thumburl: "https://upload.wikimedia.org/thumb/x.jpg",
                    width: 1200,
                    height: 800,
                    mime: "image/jpeg",
                    descriptionurl: "https://commons.wikimedia.org/wiki/File:Whitewater_Rafting.jpg",
                    extmetadata: {
                      LicenseShortName: { value: "CC BY-SA 4.0" },
                      LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                      Artist: { value: "Bob Smith" },
                    },
                  },
                ],
              },
            },
          },
        })
      )
    );
    const res = await new WikimediaProvider().search({ query: "rafting" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const item = res.items[0];
    expect(item.license).toContain("CC BY-SA");
    expect(item.creator).toBe("Bob Smith");
    expect(item.attributionRequired).toBe(true);
    expect(item.commercialUse).toBe(true); // CC BY-SA is commercial-compatible
    expect(item.attribution).toContain("Bob Smith");
  });

  it("Wikimedia reports a fetch failure honestly", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("network down"))) as typeof fetch;
    const res = await new WikimediaProvider().search({ query: "rafting" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Wikimedia");
  });
});
