import { describe, expect, it } from "vitest";
import { parseStorageUrl } from "./storage";

describe("parseStorageUrl", () => {
  it("parses a public-shaped Supabase Storage URL", () => {
    expect(parseStorageUrl("https://abcxyz.supabase.co/storage/v1/object/public/plan-pages/user-1/proj-1/page.jpg")).toEqual({
      bucket: "plan-pages",
      path: "user-1/proj-1/page.jpg",
    });
  });

  it("parses a signed-shaped Supabase Storage URL, dropping the token", () => {
    const url = "https://abcxyz.supabase.co/storage/v1/object/sign/checklist-photos/user-1/photo.jpg?token=abc.def.ghi";
    expect(parseStorageUrl(url)).toEqual({ bucket: "checklist-photos", path: "user-1/photo.jpg" });
  });

  it("decodes URL-encoded path segments", () => {
    const url = "https://abcxyz.supabase.co/storage/v1/object/public/project-files/user-1/My%20File%20(final).pdf";
    expect(parseStorageUrl(url)).toEqual({ bucket: "project-files", path: "user-1/My File (final).pdf" });
  });

  it("returns null for a URL that isn't a Supabase Storage object URL", () => {
    expect(parseStorageUrl("https://www.zillow.com/homedetails/123-main-st/12345_zpid/")).toBeNull();
  });

  it("returns null for a bare Supabase project URL with no storage path", () => {
    expect(parseStorageUrl("https://abcxyz.supabase.co/")).toBeNull();
  });
});
