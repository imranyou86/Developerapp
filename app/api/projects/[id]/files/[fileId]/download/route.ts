import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withExtension } from "@/lib/projectFiles";

export const runtime = "nodejs";
export const maxDuration = 30;

// Storage bucket URLs are public, but a plain <a href> to them won't force a
// correct filename cross-origin (the `download` attribute is ignored across
// origins in most browsers). Proxying through here sets a real
// Content-Disposition header instead.
export async function GET(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: file, error } = await supabase
    .from("project_files")
    .select("storage_url, file_name")
    .eq("id", params.fileId)
    .eq("project_id", params.id)
    .single();
  if (error || !file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const fileRes = await fetch(file.storage_url);
  if (!fileRes.ok || !fileRes.body) {
    return NextResponse.json({ error: "Could not fetch the stored file." }, { status: 502 });
  }

  const safeName = withExtension(file.file_name, file.storage_url).replace(/[\r\n"]/g, "_");
  return new NextResponse(fileRes.body, {
    headers: {
      "Content-Type": fileRes.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  });
}
