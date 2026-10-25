import { getDb } from "./_mongo.mjs";
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, x-admin-key",
};
const response = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const jsonBody = (event) => { try { return JSON.parse(event.body || "{}"); } catch { return {}; } };
async function db(path, options = {}) {
 const database=await getDb(); const [table,queryString=""]=path.split("?");
 const collection=database.collection("support_tickets"); const params=new URLSearchParams(queryString);
 const filter={}; for(const [k,v] of params.entries())if(v.startsWith("eq."))filter[k]={$eq:decodeURIComponent(v.slice(3))};
 const method=options.method||"GET";
 if(method==="GET"){let cursor=collection.find(filter);const order=params.get("order");if(order){const [f,d]=order.split(".");cursor=cursor.sort({[f]:d==="desc"?-1:1})}return (await cursor.limit(300).toArray()).map(({_id,...r})=>r)}
 const body=JSON.parse(options.body||"{}");
 if(method==="POST"){body.id=body.id||`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;body.created_at=body.created_at||new Date().toISOString();await collection.insertOne(body);return options.headers?.Prefer?.includes("return=representation")?[body]:[]}
 if(method==="PATCH"){const rows=await collection.find(filter).toArray();await collection.updateMany(filter,{$set:body});return options.headers?.Prefer?.includes("return=representation")?rows.map(({_id,...r})=>({...r,...body})):[]}
 throw new Error("Unsupported database operation");
}

function adminAuthorized(event) {
  const expected = process.env.SUPPORT_ADMIN_KEY || process.env.APPLICATIONS_ADMIN_KEY || "";
  const received = event.headers?.["x-admin-key"] || event.headers?.["X-Admin-Key"] || "";
  return Boolean(expected && received && expected === received);
}
async function discord(path, method = "GET", body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Discord bot is not configured");
  const res = await fetch(`https://discord.com/api/v10${path}`, { method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "MS3DH-TRIPE-Support/1.0" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!res.ok) throw new Error(data?.message || `Discord API error ${res.status}`);
  return data;
}
async function sendDM(userId, content) {
  const channel = await discord("/users/@me/channels", "POST", { recipient_id: userId });
  await discord(`/channels/${channel.id}/messages`, "POST", { content });
}
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  const action = event.queryStringParameters?.action || "list";
  try {
    if (event.httpMethod === "POST" && action === "submit") {
      const body = jsonBody(event);
      const name = String(body.name || "").trim().slice(0, 80);
      const discordId = String(body.discordId || "").trim();
      const category = String(body.category || "استفسار").trim().slice(0, 80);
      const message = String(body.message || "").trim().slice(0, 2500);
      if (!name || !/^\d{17,20}$/.test(discordId) || !category || message.length < 5) {
        return response(400, { ok: false, error: "أكمل بيانات الدعم وتأكد من صحة Discord User ID" });
      }
      const rows = await db("ms3dh_support_tickets?select=id,created_at", { method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name, discord_id: discordId, category, message, status: "open" }),
      });
      return response(201, { ok: true, ticket: rows?.[0] || { id: "submitted" } });
    }
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return response(405, { ok: false, error: "Method not allowed" });
    if (!adminAuthorized(event)) return response(401, { ok: false, error: "Admin authorization required" });
    if (event.httpMethod === "GET" && action === "list") {
      const tickets = await db("ms3dh_support_tickets?select=id,name,discord_id,category,message,status,reply,created_at,replied_at&order=created_at.desc&limit=300");
      return response(200, { ok: true, tickets: tickets || [] });
    }
    if (event.httpMethod === "POST" && action === "reply") {
      const body = jsonBody(event);
      const id = String(body.id || "").trim();
      const reply = String(body.reply || "").trim().slice(0, 2000);
      if (!id || !reply) return response(400, { ok: false, error: "اكتب الرد وحدد الطلب" });
      const found = await db(`ms3dh_support_tickets?id=eq.${encodeURIComponent(id)}&select=id,name,discord_id&limit=1`);
      const ticket = found?.[0];
      if (!ticket) return response(404, { ok: false, error: "Support ticket not found" });
      let dmSent = true;
      try { await sendDM(ticket.discord_id, `رد إدارة MS3DH TRIPE على طلب الدعم (${ticket.category || "دعم"}):\n\n${reply}`); }
      catch { dmSent = false; }
      const updated = await db(`ms3dh_support_tickets?id=eq.${encodeURIComponent(id)}`, { method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ reply, status: "replied", replied_at: new Date().toISOString() }),
      });
      return response(200, { ok: true, ticket: updated?.[0] || null, dmSent });
    }
    return response(400, { ok: false, error: "Unknown action" });
  } catch (error) {
    const message = error?.message || "Unexpected error";
    const status = /not configured/i.test(message) ? 503 : 502;
    return response(status, { ok: false, error: message });
  }
}
