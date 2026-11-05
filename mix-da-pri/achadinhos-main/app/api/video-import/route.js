import { createHash, timingSafeEqual } from "node:crypto";
import { importFromUrl } from "@/lib/importer";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const expected = process.env.VIDEO_STUDIO_TOKEN || "";
  const authorization = req.headers.get("authorization") || "";
  const supplied = authorization.replace(/^Bearer\s+/i, "");

  if (!expected) {
    console.error("[video-import] VIDEO_STUDIO_TOKEN ausente");
    return Response.json(
      { error: "Token do servidor não configurado", code: "SERVER_TOKEN_MISSING" },
      { status: 503 }
    );
  }

  if (!supplied) {
    return Response.json(
      { error: "Token não enviado", code: "CLIENT_TOKEN_MISSING" },
      { status: 401 }
    );
  }

  // Compara por hash: mesmo tamanho sempre, e a resposta não revela nada sobre o token certo
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(supplied).digest();

  if (!timingSafeEqual(a, b)) {
    console.error("[video-import] Token inválido");
    return Response.json({ error: "Token inválido", code: "TOKEN_INVALID" }, { status: 401 });
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
