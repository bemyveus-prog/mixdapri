import { timingSafeEqual } from "node:crypto";
import { importFromUrl } from "@/lib/importer";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const expected = process.env.VIDEO_STUDIO_TOKEN || "";
  const supplied = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  if (!expected || !supplied) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { url } = await req.json().catch(() => ({}));

  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) {
    return Response.json({ error: "Link inválido" }, { status: 400 });
  }

  try {
    const product = await importFromUrl(url.trim());
    return Response.json(product, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Falha ao importar produto" },
      { status: 500 }
    );
  }
}
