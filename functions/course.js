// صفحة الكورس: بنحط عنوان ووصف جوجل والسوشيال لكل كورس قبل ما الصفحة توصل للمتصفح
export async function onRequestGet({ request, env, next }) {
  const res = await next();
  const slug = new URL(request.url).searchParams.get("c");
  if (!slug || !env.DB || !(res.headers.get("content-type") || "").includes("html")) return res;
  let c, brand = "IK Academy";
  try {
    c = await env.DB.prepare("SELECT slug, title, subtitle, intro, seo_desc FROM courses WHERE slug = ? AND status != 'hidden'").bind(slug).first();
    const b = await env.DB.prepare("SELECT value FROM settings WHERE key = 'brand_name'").first();
    if (b && b.value) brand = b.value;
  } catch (e) { return res; }
  if (!c) return res;
  const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
  const origin = new URL(request.url).origin;
  const url = origin + "/course?c=" + encodeURIComponent(c.slug);
  const title = c.title + " | " + brand;
  const desc = clip(c.seo_desc || c.subtitle || c.intro || "", 160);
  const meta = [
    desc && `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    desc && `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(origin)}/assets/logo.webp">`,
    // بيانات منظمة لجوجل: الصفحة دي كورس
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Course", name: c.title, description: desc || c.title,
      url, inLanguage: "ar", provider: { "@type": "Organization", name: brand, sameAs: origin + "/" } }).replace(/</g, "\\u003c")}</script>`,
  ].filter(Boolean).join("");
  return new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on("head", { element(el) { el.append(meta, { html: true }); } })
    .transform(res);
}
