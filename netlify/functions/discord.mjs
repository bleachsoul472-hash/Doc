
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
        process.env.ROLE_MODERATION_ID ||
        "1519467175885279393";

      const leadershipRoleId =
        process.env.ROLE_LEADERSHIP_ID || "";

      const toStaffCard = (member, group, fallbackRole) => {
        const targetRoleId =
          group === "LEADERSHIP"
            ? leadershipRoleId
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

      const moderators = formattedMembers
        .filter((member) =>
          member.roles.some(
            (role) => String(role.id) === String(moderationRoleId)
          )
        )
        .map((member) =>
          toStaffCard(member, "MODERATOR", "مودريتزر")
        );

      const leadership = leadershipRoleId
        ? formattedMembers
            .filter((member) =>
              member.roles.some(
                (role) => String(role.id) === String(leadershipRoleId)
              )
            )
            .map((member) =>
              toStaffCard(member, "LEADERSHIP", "الإدارة العليا")
            )
        : [];

      return response(200, {
        ok: true,
        members: formattedMembers,
        moderators,
        leadership,
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
