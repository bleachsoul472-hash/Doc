import { getDb, jsonReply, readBody } from "./_mongo.mjs";

const COLLECTION = "siteContent";
const DOCUMENT_ID = "main";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, X-Site-Admin-Key", "access-control-allow-methods": "GET, PUT, OPTIONS" }, body: "" };
  }

  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type, X-Site-Admin-Key",
    "access-control-allow-methods": "GET, PUT, OPTIONS"
  };

  try {
    const db = await getDb();
    const collection = db.collection(COLLECTION);

    if (event.httpMethod === "GET") {
      const doc = await collection.findOne({ _id: DOCUMENT_ID });
      if (!doc) return jsonReply(200, { ok: true, data: null }, headers);
      const { _id, ...data } = doc;
      return jsonReply(200, { ok: true, data }, headers);
    }

    if (event.httpMethod !== "PUT") {
      return jsonReply(405, { ok: false, error: "Method not allowed" }, headers);
    }

    const expected = process.env.SITE_CONTENT_ADMIN_KEY || process.env.APPLICATIONS_ADMIN_KEY || "";
    const supplied = event.headers?.["x-site-admin-key"] || event.headers?.["X-Site-Admin-Key"] || "";
    if (!expected) return jsonReply(503, { ok: false, error: "Configure SITE_CONTENT_ADMIN_KEY in Netlify environment variables" }, headers);
    if (!supplied || supplied !== expected) return jsonReply(401, { ok: false, error: "Admin key is incorrect" }, headers);

    const body = readBody(event);
    const data = body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return jsonReply(400, { ok: false, error: "Invalid site content" }, headers);
    }
    if (JSON.stringify(data).length > 1500000) {
      return jsonReply(413, { ok: false, error: "Content too large; use image URLs instead of embedded images" }, headers);
    }

    const saved = { ...data, _savedAt: new Date().toISOString() };
    await collection.replaceOne({ _id: DOCUMENT_ID }, { _id: DOCUMENT_ID, ...saved }, { upsert: true });
    return jsonReply(200, { ok: true, saved: true, savedAt: saved._savedAt }, headers);
  } catch (error) {
    console.error("Persistent site content error:", error);
    return jsonReply(503, { ok: false, error: "Database save failed. Check MONGODB_URI and Netlify function logs." }, headers);
  }
}
