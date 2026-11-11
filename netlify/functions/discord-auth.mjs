import crypto from 'node:crypto';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    }
  });

const env = (key) =>
  (typeof Netlify !== 'undefined' ? Netlify.env.get(key) : '') ||
  process.env[key] ||
  '';

const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const b64 = (value) => Buffer.from(value).toString('base64url');

function sign(value) {
  const secret = env('NOX_SESSION_SECRET');
  if (!secret) throw new Error('NOX_SESSION_SECRET is missing');

  return crypto
    .createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

function makeToken(payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  try {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const expected = sign(body);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString()
    );

    if (!payload.exp || payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function getCookie(event, name) {
  const headers = event.headers || {};
  const raw = headers.cookie || headers.Cookie || '';

  return raw
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
}

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name.toLowerCase()] || headers[name] || '';
}

function redirect(location, cookies = []) {
  return {
    statusCode: 302,
    headers: {
      location,
      'cache-control': 'no-store'
    },
    multiValueHeaders: {
      'set-cookie': cookies
    },
    body: ''
  };
}

async function discord(path, token) {
  const response = await fetch(
    `https://discord.com/api/v10${path}`,
    {
      headers: {
        Authorization: `Bot ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Discord API ${response.status}`);
  }

  return response.json();
}

async function getMember(userId) {
  const bot = env('DISCORD_BOT_TOKEN');
  const guild = env('DISCORD_GUILD_ID');

  if (!bot || !guild) {
    throw new Error('Discord bot configuration missing');
  }

  const [member, roles] = await Promise.all([
    discord(`/guilds/${guild}/members/${userId}`, bot),
    discord(`/guilds/${guild}/roles`, bot)
  ]);

  const roleMap = new Map(roles.map(role => [
    role.id,
    role.name
  ]));

  return (member.roles || []).map(id => ({
    id,
    name: roleMap.get(id) || 'Role'
  }));
}

export const handler = async (event) => {
  try {
    const params = new URLSearchParams(
      (event.rawQuery || '').replace(/^\?/, '')
    );

    const action = params.get('action') || 'me';

    const client = env('DISCORD_CLIENT_ID');
    const secret = env('DISCORD_CLIENT_SECRET');
    const callback = env('DISCORD_REDIRECT_URI');
    const guild = env('DISCORD_GUILD_ID');

    if (action === 'login') {
      if (!client || !secret || !callback) {
        return {
          statusCode: 503,
          body: 'Discord OAuth is not configured.'
        };
      }

      const state = crypto.randomBytes(24).toString('hex');

      const target = new URL(
        'https://discord.com/oauth2/authorize'
      );

      target.searchParams.set('client_id', client);
      target.searchParams.set('redirect_uri', callback);
      target.searchParams.set('response_type', 'code');
      target.searchParams.set('scope', 'identify');
      target.searchParams.set('state', state);

      return redirect(target.toString(), [
        cookie('nox_oauth_state', state, 600)
      ]);
    }

    if (action === 'callback') {
      const state = params.get('state') || '';
      const saved = getCookie(event, 'nox_oauth_state');
      const code = params.get('code');

      if (!state || !saved || state !== saved || !code) {
        return {
          statusCode: 400,
          body: 'Discord login could not be verified.'
        };
      }

      if (!client || !secret || !callback) {
        return {
          statusCode: 503,
          body: 'Discord OAuth configuration missing.'
        };
      }

      const form = new URLSearchParams({
        client_id: client,
        client_secret: secret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback
      });

      const tokenResponse = await fetch(
        'https://discord.com/api/v10/oauth2/token',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded'
          },
          body: form
        }
      );

      if (!tokenResponse.ok) {
        return {
          statusCode: 502,
          body: 'Discord token exchange failed.'
        };
      }

      const token = await tokenResponse.json();

      const userResponse = await fetch(
        'https://discord.com/api/v10/users/@me',
        {
          headers: {
            authorization: `Bearer ${token.access_token}`
          }
        }
      );

      if (!userResponse.ok) {
        return {
          statusCode: 502,
          body: 'Could not read Discord profile.'
        };
      }

      const user = await userResponse.json();

      let roles = [];

      try {
        roles = await getMember(user.id);
      } catch (error) {
        console.error('Member lookup:', error.message);
      }

      const adminIds = (env('NOX_ADMIN_ROLE_IDS') || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      const isAdmin = roles.some(role =>
        adminIds.includes(role.id)
      );

      const session = makeToken({
        id: user.id,
        username: user.username,
        global_name: user.global_name || user.username,
        avatar: user.avatar,
        roles,
        isAdmin,
        exp: Date.now() + 6 * 60 * 60 * 1000
      });

      const site = env('SITE_URL') || '/';

      return redirect(site, [
        cookie('nox_session', session, 21600),
        cookie('nox_oauth_state', '', 0)
      ]);
    }

    if (action === 'logout') {
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        },
        multiValueHeaders: {
          'set-cookie': [
            cookie('nox_session', '', 0)
          ]
        },
        body: JSON.stringify({ ok: true })
      };
    }

    const session = verifyToken(
      getCookie(event, 'nox_session')
    );

    if (!session) {
      return json({ authenticated: false });
    }

    if (action === 'members') {
      try {
        session.roles = await getMember(session.id);

        const adminIds = (env('NOX_ADMIN_ROLE_IDS') || '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);

        if (!session.roles.some(role =>
          adminIds.includes(role.id)
        )) {
          return json({ error: 'غير مصرح' }, 403);
        }

        const bot = env('DISCORD_BOT_TOKEN');

        const roles = await discord(
          `/guilds/${guild}/roles`,
          bot
        );

        const roleMap = new Map(roles.map(role => [
          role.id,
          role.name
        ]));

        let all = [];
        let after = '';

        for (let page = 0; page < 5; page++) {
          const path =
            `/guilds/${guild}/members?limit=1000` +
            (after ? `&after=${after}` : '');

          const batch = await discord(path, bot);

          if (!batch.length) break;

          all = all.concat(batch);
          after = batch[batch.length - 1].user.id;

          if (batch.length < 1000) break;
        }

        const members = all
          .filter(member => !member.user.bot)
          .map(member => ({
            id: member.user.id,
            username: member.user.username,
            displayName:
              member.nick ||
              member.user.global_name ||
              member.user.username,

            avatar: member.user.avatar
              ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=128`
              : `https://cdn.discordapp.com/embed/avatars/0.png`,

            roles: (member.roles || []).map(id => ({
              id,
              name: roleMap.get(id) || 'Role'
            }))
          }));

        return json({ members });

      } catch (error) {
        console.error('Members error:', error);

        return json({
          error: 'تعذر تحميل أعضاء Discord: ' + error.message
        }, 502);
      }
    }

    try {
      session.roles = await getMember(session.id);
    } catch (error) {
      console.error('Role refresh:', error.message);
    }

    const adminIds = (env('NOX_ADMIN_ROLE_IDS') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    session.isAdmin = session.roles.some(role =>
      adminIds.includes(role.id)
    );

    return json({
      authenticated: true,
      user: {
        id: session.id,
        username: session.username,
        displayName: session.global_name,
        avatar: session.avatar
          ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=128`
          : null,
        roles: session.roles,
        isAdmin: session.isAdmin
      }
    });

  } catch (error) {
    console.error('Discord auth error:', error);

    return json({
      error: 'حدث خطأ في خدمة تسجيل الدخول. راجع سجلات Netlify.'
    }, 500);
  }
};
   
