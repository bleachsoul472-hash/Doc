const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};
const response = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "GET") return response(405, { ok: false, error: "Method not allowed" });

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) {
    return response(503, {
      ok: false,
      error: "Discord integration is not configured. Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in Netlify environment variables.",
    });
  }

  const action = event.queryStringParameters?.action || "overview";
  const api = async (path) => {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: { Authorization: `Bot ${token}`, "User-Agent": "MS3DH-TRIPE-Community/1.0" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || `Discord API error ${res.status}`);
    return body;
  };

  try {
    if (action === "overview") {
      const [guild, roles] = await Promise.all([
        api(`/guilds/${guildId}?with_counts=true`),
        api(`/guilds/${guildId}/roles`),
      ]);
      return response(200, {
        ok: true,
        guild: {
          id: guild.id,
          name: guild.name,
          icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
          approximate_member_count: guild.approximate_member_count ?? null,
          approximate_presence_count: guild.approximate_presence_count ?? null,
        },
        roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed })),
      });
    }

    if (action === "roles") {
      const roles = await api(`/guilds/${guildId}/roles`);
      return response(200, { ok: true, roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed })) });
    }

    if (action === "members") {
      // Discord requires the privileged Server Members Intent for this endpoint.
      const limit = Math.min(1000, Math.max(1, Number(event.queryStringParameters?.limit) || 1000));
      const members = await api(`/guilds/${guildId}/members?limit=${limit}`);
      const roles = await api(`/guilds/${guildId}/roles`);
      const roleMap = new Map(roles.map((r) => [r.id, r.name]));
      return response(200, {
        ok: true,
        members: members.map((m) => ({
          id: m.user.id,
          username: m.user.global_name || m.user.username,
          avatar: m.user.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png` : null,
          nickname: m.nick || null,
          roles: m.roles.map((id) => ({ id, name: roleMap.get(id) || "Unknown role" })),
          bot: Boolean(m.user.bot),
        })),
        returned: members.length,
        note: "Returns at most the requested first page; pagination can be added for larger guilds.",
      });
    }

    return response(400, { ok: false, error: "Unknown action. Use overview, roles, or members." });
  } catch (error) {
    return response(502, { ok: false, error: error.message || "Discord request failed" });
  }
}
