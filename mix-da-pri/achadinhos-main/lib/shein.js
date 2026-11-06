// Importador SHEIN.
// A SHEIN não tem API de produtos para afiliados. Então:
//  1. segue o link de afiliado (onelink.shein.com/...) até achar o ID do produto (goods_id);
//  2. lê nome/foto das meta tags da página de compartilhamento;
//  3. abre a página do produto e procura preço, preço "de" e fotos nos dados embutidos.
// O link de afiliado colado é SEMPRE mantido como destino (é ele que paga a comissão).

const UAS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];

export function isShein(url) {
  try { return /(^|\.)shein\.(com|com\.br|top)$|sheinlink|shein\.top/i.test(new URL(url).hostname); }
  catch { return false; }
}

function short(u) {
  try { const x = new URL(u); return (x.hostname + x.pathname).slice(0, 60); } catch { return String(u).slice(0, 60); }
}

const decodeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/​/g, "").trim();

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re) || html.match(re2);
  return m ? decodeHtml(m[1]) : null;
}

// goods_id aparece como ...-p-12345678.html, goods_id=12345678 ou "goods_id":"12345678"
export function parseGoodsId(text) {
  if (!text) return null;
  let t = String(text);
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
  const m = t.match(/-p-(\d{5,})(?:-cat-\d+)?\.html/) || t.match(/goods_?id["'=:\s]+["']?(\d{5,})/i);
  return m ? m[1] : null;
}

async function get(url, ua, log) {
  const chain = [url];
  let current = url;
  for (let hop = 0; hop < 8; hop++) {
    const r = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "pt-BR,pt;q=0.9" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const loc = r.headers.get("location");
    log.push(`${r.status} ${short(current)}`);
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      chain.push(current);
      continue;
    }
    const html = r.headers.get("content-type")?.includes("html") ? (await r.text()).slice(0, 1500000) : "";
    // redirecionamento por JavaScript / meta refresh
    const js = html.match(/(?:location\.(?:href|replace)\s*\(?\s*=?\s*|url=)["']?(https?:\/\/[^"'\s>)]+)/i);
    if (js) chain.push(js[1]);
    return { chain, html, status: r.status };
  }
  return { chain, html: "", status: 0 };
}

// Títulos que a SHEIN usa na página de compartilhamento quando não manda o nome do produto
export function isGenericSheinTitle(t) {
  if (!t) return true;
  return /n[ãa]o perca|economize muito|oferta grande|^shein\b.*(brasil|moda|online|compre)|^shein$/i.test(t.trim());
}

const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };

// Dados embutidos na página do produto (JSON dentro de <script>)
function parseProductPage(html) {
  const out = {};
  const sale = html.match(/"salePrice"\s*:\s*\{[^}]*?"amount"\s*:\s*"?([\d.,]+)/) || html.match(/"sale_price"\s*:\s*\{[^}]*?"amount"\s*:\s*"?([\d.,]+)/);
  const retail = html.match(/"retailPrice"\s*:\s*\{[^}]*?"amount"\s*:\s*"?([\d.,]+)/) || html.match(/"retail_price"\s*:\s*\{[^}]*?"amount"\s*:\s*"?([\d.,]+)/);
  if (sale) out.price = num(sale[1]);
  if (retail) out.original_price = num(retail[1]);
  if (out.price && out.original_price && out.original_price <= out.price) out.original_price = null;
  // JSON-LD (quando existe)
  const ld = html.match(/"@type"\s*:\s*"Product"[\s\S]{0,4000}?"price"\s*:\s*"?([\d.,]+)/);
  if (!out.price && ld) out.price = num(ld[1]);
  const name = html.match(/"goods_name"\s*:\s*"([^"]{8,300})"/);
  if (name) out.title = decodeHtml(name[1].replace(/\\u([\da-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/"));
  // fotos: imagens originais do produto
  const imgs = [...html.matchAll(/"origin_image"\s*:\s*"((?:https?:)?\\?\/\\?\/img\.ltwebstatic\.com[^"]+)"/g)]
    .map((m) => m[1].replace(/\\\//g, "/"))
    .map((u) => (u.startsWith("//") ? "https:" + u : u));
  out.image_urls = [...new Set(imgs)].slice(0, 8);
  return out;
}

export async function importShein(url) {
  const log = [];
  const warnings = [];
  const out = { platform: "shein", link: url, title: null, image_url: null, image_urls: [], price: null, original_price: null };
  const started = Date.now();

  // 1. segue o link de afiliado
  let goodsId = parseGoodsId(url);
  let shareHtml = "";
  for (const ua of UAS) {
    if (Date.now() - started > 9000) break;
    try {
      const r = await get(url, ua, log);
      shareHtml ||= r.html;
      goodsId ||= r.chain.map(parseGoodsId).find(Boolean) || parseGoodsId(r.html);
      const t = r.html && meta(r.html, "og:title");
      if (r.html && !out.image_url) out.image_url = meta(r.html, "og:image");
      if (t && !isGenericSheinTitle(t)) out.title = t.replace(/\s*\|\s*SHEIN.*$/i, "").trim();
      if (goodsId && out.title) break;
    } catch (e) {
      log.push(`erro: ${e.name === "TimeoutError" ? "tempo esgotado" : e.message}`);
    }
  }

  // 2. página do produto: preço, preço "de", nome e fotos
  if (goodsId && Date.now() - started < 16000) {
    for (const base of ["https://m.shein.com/br/", "https://br.shein.com/"]) {
      try {
        const r = await get(`${base}x-p-${goodsId}.html`, UAS[0], log);
        if (!r.html) continue;
        const p = parseProductPage(r.html);
        out.price ??= p.price;
        out.original_price ??= p.original_price;
        if (!out.title && p.title && !isGenericSheinTitle(p.title)) out.title = p.title;
        if (!out.title) { const t = meta(r.html, "og:title"); if (t && !isGenericSheinTitle(t)) out.title = t.replace(/\s*\|\s*SHEIN.*$/i, "").trim(); }
        if (!out.image_url) out.image_url = p.image_urls[0] || meta(r.html, "og:image");
        if (p.image_urls.length) out.image_urls = p.image_urls;
        if (out.price) break;
      } catch (e) {
        log.push(`erro: ${e.name === "TimeoutError" ? "tempo esgotado" : e.message}`);
      }
    }
  }

  if (out.image_url && !out.image_urls.includes(out.image_url)) out.image_urls = [out.image_url, ...out.image_urls].slice(0, 8);
  out.link = url; // sempre o link de afiliado colado

  const missing = [!out.title && "título", !out.image_url && "foto", !out.price && "preço"].filter(Boolean);
  if (missing.length) {
    warnings.push(
      `A SHEIN não liberou: ${missing.join(", ")}. Preencha à mão (seu link de afiliado fica salvo).` +
      ` [diagnóstico: ID ${goodsId || "não achado"} · ${log.join(" → ")}]`
    );
  }
  if (!shareHtml && !goodsId) warnings.push("Não consegui abrir o link. Confira se é o link do painel de afiliados (onelink.shein.com).");
  return { ...out, warnings };
}
