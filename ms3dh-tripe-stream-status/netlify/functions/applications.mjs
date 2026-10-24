const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, x-admin-key",
};
const response = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const jsonBody = (event) => { try { return JSON.parse(event.body || "{}"); } catch { return {}; } };
const settingsKey = "applications";

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Application storage is not configured");
  return { url, key };
}
async function db(path, options = {}) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!res.ok) throw new Error(data?.message || data?.hint || `Database error ${res.status}`);
  return data;
}
async function getSettings() {
  const rows = await db(`ms3dh_settings?key=eq.${settingsKey}&select=key,value&limit=1`);
  return rows?.[0]?.value || { open: false, roleId: process.env.DISCORD_ACCEPTED_ROLE_ID || "" };
}
async function putSettings(value) {
  const record = { key: settingsKey, value: { open: value.open === true, roleId: String(value.roleId || "").trim() } };
  await db("ms3dh_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(record),
  });
  return record.value;
}
function adminAuthorized(event) {
  const expected = process.env.APPLICATIONS_ADMIN_KEY || "";
  const received = event.headers?.["x-admin-key"] || event.headers?.["X-Admin-Key"] || "";
  return Boolean(expected && received && expected === received);
}
async function discord(path, method = "GET", body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Discord bot is not configured");
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "MS3DH-TRIPE-Applications/1.0" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!res.ok) throw new Error(data?.message || `Discord API error ${res.status}`);
  return data;
}
async function sendApplicationWebhook(application) {
  const webhookUrl = process.env.DISCORD_APPLICATIONS_WEBHOOK_URL || "";
  if (!webhookUrl) return false;
  const typeNames = { moderation: "الإدارة والمودريتزر", events: "تنظيم الفعاليات", content: "صناعة المحتوى والبثوث" };
  const embed = {
    title: "طلب تقديم جديد · MS3DH TRIPE",
    color: 0xe53935,
    fields: [
      { name: "المتقدم", value: String(application.name || "—").slice(0, 1000), inline: true },
      { name: "نوع التقديم", value: typeNames[application.type] || application.type || "غير محدد", inline: true },
      { name: "Discord User ID", value: String(application.discord_id || "—"), inline: true },
      { name: "العمر", value: String(application.age ?? "—"), inline: true },
      { name: "الخبرة", value: String(application.experience || "—").slice(0, 1000), inline: false },
      { name: "سبب التقديم", value: String(application.reason || "—").slice(0, 1000), inline: false },
      { name: "أوقات التواجد", value: String(application.availability || "—").slice(0, 500), inline: false },
      { name: "رقم الطلب", value: String(application.id || "—"), inline: false },
    ],
    footer: { text: "راجع الطلب من لوحة إدارة الموقع" },
    timestamp: application.created_at || new Date().toISOString(),
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "MS3DH TRIPE · Applications", embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord webhook error ${res.status}`);
  return true;
}
async function sendDM(userId, content) {
  const channel = await discord("/users/@me/channels", "POST", { recipient_id: userId });
  await discord(`/channels/${channel.id}/messages`, "POST", { content });
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  const action = event.queryStringParameters?.action || "status";
  try {
    if (event.httpMethod === "GET" && action === "status") {
      const settings = await getSettings();
      return response(200, { ok: true, open: settings.open === true });
    }
    if (event.httpMethod === "POST" && action === "submit") {
      const settings = await getSettings();
      if (settings.open !== true) return response(403, { ok: false, error: "Applications are closed" });
      const body = jsonBody(event);
      const name = String(body.name || "").trim().slice(0, 80);
      const discordId = String(body.discordId || "").trim();
      const age = Number(body.age);
      const experience = String(body.experience || "").trim().slice(0, 1500);
      const reason = String(body.reason || "").trim().slice(0, 2000);
      const availability = String(body.availability || "").trim().slice(0, 200);
      if (!name || !/^\d{17,20}$/.test(discordId) || !Number.isInteger(age) || age < 13 || age > 99 || !experience || !reason || !availability) {
        return response(400, { ok: false, error: "Please complete all fields with valid information" });
      }
      const type = String(body.type || "").trim();
      if (!["moderation", "events", "content"].includes(type)) return response(400, { ok: false, error: "Please select a valid application type" });
      const rows = await db("ms3dh_applications?select=id,created_at,name,discord_id,age,experience,reason,availability,type,status", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name, discord_id: discordId, age, experience, reason, availability, type, status: "pending" }),
      });
      const application = rows?.[0] || { id: "submitted", name, discord_id: discordId, age, experience, reason, availability, type };
      let discordNotified = false;
      try { discordNotified = await sendApplicationWebhook(application); } catch (notifyError) { console.error("Application Discord notification failed:", notifyError?.message || notifyError); }
      return response(201, { ok: true, application, discordNotified });
    }
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return response(405, { ok: false, error: "Method not allowed" });
    if (!adminAuthorized(event)) return response(401, { ok: false, error: "Admin authorization required" });

    if (event.httpMethod === "GET" && action === "list") {
      const [settings, applications] = await Promise.all([
        getSettings(),
        db("ms3dh_applications?select=id,name,discord_id,age,experience,reason,availability,type,status,created_at,reviewed_at&order=created_at.desc&limit=250"),
      ]);
      return response(200, { ok: true, settings, applications: applications || [] });
    }
    if (event.httpMethod === "POST" && action === "settings") {
      const body = jsonBody(event);
      const roleId = String(body.roleId || "").trim();
      if (roleId && !/^\d{17,20}$/.test(roleId)) return response(400, { ok: false, error: "Invalid Discord role ID" });
      const settings = await putSettings({ open: body.open === true, roleId });
      return response(200, { ok: true, settings });
    }
    if (event.httpMethod === "POST" && action === "decision") {
      const body = jsonBody(event);
      const id = String(body.id || "").trim();
      const decision = String(body.decision || "");
      if (!id || !["accepted", "rejected"].includes(decision)) return response(400, { ok: false, error: "Invalid decision" });
      const found = await db(`ms3dh_applications?id=eq.${encodeURIComponent(id)}&select=id,name,discord_id,type,status&limit=1`);
      const app = found?.[0];
      if (!app) return response(404, { ok: false, error: "Application not found" });
      if (app.status !== "pending") return response(409, { ok: false, error: "Application already reviewed" });
      const settings = await getSettings();
      if (decision === "accepted") {
        const guildId = process.env.DISCORD_GUILD_ID;
        const roleId = settings.roleId || process.env.DISCORD_ACCEPTED_ROLE_ID || "";
        if (!guildId || !roleId) return response(503, { ok: false, error: "Set the Discord server ID and accepted role ID first" });
        await discord(`/guilds/${guildId}/members/${app.discord_id}/roles/${roleId}`, "PUT");
      }
      let dmSent = true;
      try {
        const message = decision === "accepted"
          ? `تم قبول طلبك للانضمام إلى فريق MS3DH TRIPE. مبروك!${settings.roleId || process.env.DISCORD_ACCEPTED_ROLE_ID ? " تمت إضافة الرتبة المحددة إلى حسابك." : ""}`
          : "شكرًا لتقديمك إلى فريق MS3DH TRIPE. نعتذر، لم يتم قبول طلبك هذه المرة.";
        await sendDM(app.discord_id, message);
      } catch { dmSent = false; }
      const updated = await db(`ms3dh_applications?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: decision, reviewed_at: new Date().toISOString() }),
      });
      return response(200, { ok: true, application: updated?.[0] || null, dmSent, roleAssigned: decision === "accepted" });
    }
    return response(400, { ok: false, error: "Unknown action" });
  } catch (error) {
    const message = error?.message || "Unexpected error";
    const status = /not configured/i.test(message) ? 503 : 502;
    return response(status, { ok: false, error: message });
  }
}
