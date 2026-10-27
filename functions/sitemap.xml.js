// خريطة الموقع لجوجل: الرئيسية والمكتبة وصفحات الكورسات الظاهرة بس
export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;
  const urls = [origin + "/", origin + "/library"];
  try {
    const { results } = await env.DB.prepare("SELECT slug FROM courses WHERE status != 'hidden' ORDER BY sort, id").all();
    for (const c of results || []) urls.push(origin + "/course?c=" + encodeURIComponent(c.slug));
  } catch (e) {}
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "  <url><loc>" + esc(u) + "</loc></url>").join("\n") + "\n</urlset>\n";
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
