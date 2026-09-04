import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { withExtension } from "@/lib/projectFiles";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { fileIds?: string[] };

  let query = supabase
    .from("project_files")
    .select("id, storage_url, file_name")
    .eq("project_id", params.id);
  if (body.fileIds && body.fileIds.length > 0) {
    query = query.in("id", body.fileIds);
  }

  const { data: files, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files to download." }, { status: 400 });
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();

  const results = await Promise.allSettled(
    files.map(async (f) => {
      const res = await fetch(f.storage_url);
      if (!res.ok) throw new Error(`Failed to fetch ${f.file_name}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      let name = withExtension(f.file_name, f.storage_url);
      let i = 2;
      while (usedNames.has(name)) {
        name = `${withExtension(f.file_name, f.storage_url).replace(/(\.[^.]+)?$/, "")} (${i})${name.match(/\.[^.]+$/)?.[0] ?? ""}`;
        i++;
      }
      usedNames.add(name);
      zip.file(name, buffer);
    })
  );

  const failedCount = results.filter((r) => r.status === "rejected").length;
  if (failedCount === files.length) {
    return NextResponse.json({ error: "Could not fetch any of the selected files." }, { status: 502 });
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="project-files.zip"`,
    },
  });
}
