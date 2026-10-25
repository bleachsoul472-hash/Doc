import { getDb } from "./_mongo.mjs";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

const response = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return response(405, {
      ok: false,
      error: "Method not allowed",
    });
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !guildId) {
    return response(503, {
      ok: false,
      error: "Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in Netlify environment variables.",
    });
  }

  const action = event.queryStringParameters?.action || "overview";

  const api = async (path) => {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "MS3DH-TRIPE-Community/1.0",
      },
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(body.message || `Discord API error ${res.status}`);
    }

    return body;
  };

  try {
    // A single cached snapshot feeds the public website. Cache lives in MongoDB,
    // so every visitor sees the same latest Discord data without hitting Discord
    // on every page view.
    if (action === "snapshot") {
      const db = await getDb();
      const cache = db.collection("discord_snapshots");
      const cached = await cache.findOne({ _id: String(guildId) });
      const force = event.queryStringParameters?.force === "1";
      if (!force && cached?.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < 5 * 60 * 1000 && cached.data) {
        return response(200, { ok: true, ...cached.data, cached: true, updatedAt: cached.updatedAt });
      }

      const [guild, roles] = await Promise.all([
        api(`/guilds/${guildId}?with_counts=true`),
        api(`/guilds/${guildId}/roles`),
      ]);

      // Discord's member-list endpoint is paginated. Read sequentially to avoid
      // burst traffic; cap at 10,000 members per refresh for Netlify execution limits.
      const rawMembers = [];
      let after = "";
      for (let page = 0; page < 3; page++) {
        const path = `/guilds/${guildId}/members?limit=1000${after ? `&after=${after}` : ""}`;
        const batch = await api(path);
        if (!Array.isArray(batch) || batch.length === 0) break;
        rawMembers.push(...batch);
        after = batch[batch.length - 1]?.user?.id || "";
        if (batch.length < 1000 || !after) break;
      }

      const roleMap = new Map(roles.map(role => [role.id, role.name]));
      const formattedMembers = rawMembers.map(member => ({
        id: member.user.id,
        username: member.user.global_name || member.user.username,
        avatar: member.user.avatar
          ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number(member.user.discriminator || 0) % 5}.png`,
        nickname: member.nick || null,
        roles: (member.roles || []).map(id => ({ id, name: roleMap.get(id) || "Unknown role" })),
        bot: Boolean(member.user.bot),
      }));
      const leadershipId = process.env.ROLE_LEADERSHIP_ID || "";
      const moderationId = process.env.ROLE_MODERATION_ID || "";
      const supportId = process.env.ROLE_SUPPORT_ID || "";
      const normalize = value => String(value || "").toLowerCase().replace(/[\s_\-]+/g, "");
      const hasRole = (member, configuredId, terms) =>
        (configuredId && member.roles.some(role => String(role.id) === String(configuredId))) ||
        member.roles.some(role => terms.some(term => normalize(role.name).includes(term)));
      const toStaff = (member, group, fallback) => {
        const targetId = group === "LEADERSHIP" ? leadershipId : group === "SUPPORT" ? supportId : moderationId;
        const role = member.roles.find(item => targetId && String(item.id) === String(targetId));
        return { ...member, name: member.nickname || member.username, discord: member.username, discordId: member.id, photo: member.avatar || "", rank: "DISCORD", group, team: "Discord", role: role?.name || fallback, _discord: true, discordUrl: `https://discord.com/users/${member.id}` };
      };
      const leadership = formattedMembers.filter(m => hasRole(m, leadershipId, ["الإدارةالعليا", "ادارةعليا", "leadership", "management", "administrator", "admin"])).map(m => toStaff(m, "LEADERSHIP", "الإدارة العليا"));
      const moderators = formattedMembers.filter(m => hasRole(m, moderationId, ["مشرف", "مودريت", "moderator", "moderation", "mod"])).map(m => toStaff(m, "MODERATOR", "مشرف"));
      const support = formattedMembers.filter(m => hasRole(m, supportId, ["دعم", "support", "helper"])).map(m => toStaff(m, "SUPPORT", "الدعم"));
      const counts = new Map();
      for (const member of formattedMembers) for (const role of member.roles) counts.set(role.id, (counts.get(role.id) || 0) + 1);
      const teams = roles.filter(role => role.name !== "@everyone" && !role.managed).sort((a,b) => b.position - a.position).map(role => ({
        id: role.id, code: "DISCORD ROLE", name: role.name,
        desc: "رتبة مسترجعة تلقائيًا من سيرفر Discord.",
        count: `${counts.get(role.id) || 0} عضو`, roleId: role.id, source: "discord"
      }));
      const data = {
        guild: { id: guild.id, name: guild.name, icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null,
          approximate_member_count: guild.approximate_member_count ?? null,
          approximate_presence_count: guild.approximate_presence_count ?? null },
        roles: roles.map(role => ({ id: role.id, name: role.name, color: role.color, position: role.position, managed: role.managed })),
        members: formattedMembers, leadership, moderators, support, teams,
        memberCount: guild.approximate_member_count ?? rawMembers.length,
        returned: rawMembers.length,
        truncated: rawMembers.length >= 3000
      };
      const updatedAt = new Date().toISOString();
      await cache.updateOne({ _id: String(guildId) }, { $set: { data, updatedAt } }, { upsert: true });
      return response(200, { ok: true, ...data, cached: false, updatedAt });
    }

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
          icon: guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
            : null,
          approximate_member_count:
            guild.approximate_member_count ?? null,
          approximate_presence_count:
            guild.approximate_presence_count ?? null,
        },
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          managed: role.managed,
        })),
      });
    }

    if (action === "roles") {
      const roles = await api(`/guilds/${guildId}/roles`);

      return response(200, {
        ok: true,
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          color: role.color,
          position: role.position,
          managed: role.managed,
        })),
      });
    }

    if (action === "members") {
      const limit = Math.min(
        1000,
        Math.max(
          1,
          Number(event.queryStringParameters?.limit) || 1000
        )
      );

      const [members, roles] = await Promise.all([
        api(`/guilds/${guildId}/members?limit=${limit}`),
        api(`/guilds/${guildId}/roles`),
      ]);

      const roleMap = new Map(
        roles.map((role) => [role.id, role.name])
      );

      const formattedMembers = members.map((member) => ({
        id: member.user.id,
        username: member.user.global_name || member.user.username,
        avatar: member.user.avatar
          ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number(member.user.discriminator || 0) % 5}.png`,
        nickname: member.nick || null,
        roles: (member.roles || []).map((id) => ({
          id,
          name: roleMap.get(id) || "Unknown role",
        })),
        bot: Boolean(member.user.bot),
      }));

      const moderationRoleId =
        process.env.ROLE_MODERATION_ID || "";

      const leadershipRoleId = process.env.ROLE_LEADERSHIP_ID || "";
      const supportRoleId = process.env.ROLE_SUPPORT_ID || "";

      const toStaffCard = (member, group, fallbackRole) => {
        const targetRoleId =
          group === "LEADERSHIP"
            ? leadershipRoleId
            : group === "SUPPORT"
              ? supportRoleId
              : moderationRoleId;

        const matchingRole = member.roles.find(
          (role) => String(role.id) === String(targetRoleId)
        );

        return {
          ...member,
          name: member.nickname || member.username,
          discord: member.username,
          discordId: member.id,
          photo: member.avatar || "",
          rank: "DISCORD",
          group,
          team: "Discord",
          role: matchingRole?.name || fallbackRole,
          _discord: true,
          discordUrl: `https://discord.com/users/${member.id}`,
        };
      };

      // Prefer exact Discord role IDs. If an ID is not configured, fall back
      // to recognizable role names so the staff sections are not silently empty.
      const roleNameMatches = (member, terms) => member.roles.some((role) => {
        const name = String(role.name || "").toLowerCase().replace(/[\s_-]+/g, "");
        return terms.some((term) => name.includes(term));
      });
      const hasRole = (member, configuredId, terms) =>
        (configuredId && member.roles.some((role) => String(role.id) === String(configuredId))) ||
        roleNameMatches(member, terms);

      const moderators = formattedMembers
        .filter((member) => hasRole(member, moderationRoleId, ["مشرف", "مودريت", "moderator", "moderation", "mod"]))
        .map((member) => toStaffCard(member, "MODERATOR", "مشرف"));

      const leadership = formattedMembers
        .filter((member) => hasRole(member, leadershipRoleId, ["الإدارةالعليا", "ادارةعليا", "إدارة", "ادارة", "leadership", "management", "administrator", "admin"]))
        .map((member) => toStaffCard(member, "LEADERSHIP", "الإدارة العليا"));

      const support = formattedMembers
        .filter((member) => hasRole(member, supportRoleId, ["دعم", "support", "helper"]))
        .map((member) => toStaffCard(member, "SUPPORT", "الدعم"));

      return response(200, {
        ok: true,
        members: formattedMembers,
        moderators,
        leadership,
        support,
        supportCount: support.length,
        moderatorCount: moderators.length,
        leadershipCount: leadership.length,
        returned: formattedMembers.length,
      });
    }

    return response(400, {
      ok: false,
      error: "Unknown action. Use overview, roles, or members.",
    });
  } catch (error) {
    return response(502, {
      ok: false,
      error: error.message || "Discord request failed",
    });
  }
}
