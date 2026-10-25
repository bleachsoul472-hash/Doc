import { getStore } from "@netlify/blobs";

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Site-Admin-Key",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
};

const reply = (statusCode, payload) => ({
  statusCode,
  headers,
  body: JSON.stringify(payload),
});

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    // Netlify Blobs is durable storage; it is independent from MongoDB.
    const store = getStore("ms3dh-site-content");

    if (event.httpMethod === "GET") {
      const data = await store.get("main", { type: "json" });
      return reply(200, { ok: true, data: data ?? null });
    }

    if (event.httpMethod !== "PUT") {
      return reply(405, { ok: false, error: "Method not allowed" });
    }

    const key = process.env.SITE_CONTENT_ADMIN_KEY || process.env.APPLICATIONS_ADMIN_KEY || "";
    const supplied = event.headers?.["x-site-admin-key"] || event.headers?.["X-Site-Admin-Key"] || "";
    if (!key) return reply(503, { ok: false, error: "Configure SITE_CONTENT_ADMIN_KEY in Netlify environment variables" });
    if (!supplied || supplied !== key) return reply(401, { ok: false, error: "Admin key is incorrect" });

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return reply(400, { ok: false, error: "Invalid JSON body" }); }
    const data = body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return reply(400, { ok: false, error: "Invalid site content" });
    }
    if (JSON.stringify(data).length > 1500000) {
      return reply(413, { ok: false, error: "Content too large; use image URLs instead of embedded images" });
    }

    await store.setJSON("main", { ...data, _savedAt: new Date().toISOString() });
    return reply(200, { ok: true, saved: true });
  } catch (error) {
    console.error("content function error:", error);
    return reply(503, { ok: false, error: "Netlify Blobs storage failed. Check the Netlify deploy and function logs." });
  }
}
