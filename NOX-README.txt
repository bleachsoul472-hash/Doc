NOX WEBSITE + DISCORD LOGIN + ROLE-BASED CONTROL PANEL

FILES
- index.html: original NOX site with Discord login/profile/roles and a role-gated Admin link.
- NOX-admin.html: separate admin page. Only Discord users with configured admin role IDs can enter.
- netlify/functions/discord-auth.mjs: Discord OAuth login/callback/session/profile/role check.
- netlify/functions/nox-content.mjs: public content read + role-protected content save using Supabase server credentials.
- NOX-supabase-setup.sql: database setup.
- netlify.toml: Netlify publish/functions config.
- .env.example: required Netlify environment variables.

SETUP
1. Create a Discord application at https://discord.com/developers/applications.
2. In OAuth2, add this Redirect URI exactly:
   https://YOUR-SITE.netlify.app/.netlify/functions/discord-auth?action=callback
3. Create a Discord bot, add it to your server, and keep its token secret.
4. Copy the server (guild) ID and the ID of each role allowed to edit the website.
5. In Supabase SQL Editor, run NOX-supabase-setup.sql.
6. Deploy this folder to Netlify (GitHub repository or manual deploy).
7. Add all variables from .env.example in Netlify > Site configuration > Environment variables.
   DISCORD_REDIRECT_URI must be the exact callback URL above.
   SITE_URL must be the public site origin, without a trailing path.
   NOX_ADMIN_ROLE_IDS accepts comma-separated role IDs.
   NOX_SESSION_SECRET must be a long random secret.
   SUPABASE_SERVICE_ROLE_KEY is server-only. Never place it in index.html or NOX-admin.html.
8. Redeploy after adding/changing environment variables.

HOW IT WORKS
- Visitors sign in using Discord OAuth2 (identify scope only).
- The server checks whether the user belongs to the configured Discord guild and fetches their current roles using the bot.
- The website shows the Discord profile and role names.
- The "إدارة الموقع" link appears only when the user has a role listed in NOX_ADMIN_ROLE_IDS.
- The admin API checks the signed HttpOnly session and role IDs again before every save. Hiding the link alone is not the security boundary.
- Sessions expire after six hours. Logout clears the session cookie.
- The intro overlay fallback was reduced from 3.6 seconds to 0.85 seconds. The rest of the static homepage does not wait for Discord authentication.

IMPORTANT LIMITS
- Discord bot must be in the target server. The bot token remains only in Netlify environment variables.
- The role-based sign-in and protected JSON content API are implemented, but each public website section still needs its final rendering/binding to the saved content keys (links, channels, news, staff, about, rules). The existing site visual sections remain intact in this build.
- Automatic live/offline detection for Kick/TikTok/YouTube needs each platform's supported API or a trusted status provider; adding a channel record alone does not guarantee a live status.
- The admin editor currently edits structured JSON per section. It is not yet a visual drag-and-drop editor.


COMMUNITY LEADERSHIP PICKER
- Open NOX-admin.html after signing in with a Discord account that has an allowed admin role.
- Open the tab: اختيار المسؤول ونائبه.
- Select the community lead and deputy from the Discord member dropdowns, then save.
- The public STAFF/الإدارة section displays only those two selected profiles (avatar, display name and Discord profile link).
- The selection is stored in the existing nox_site_content row under content.management. No extra SQL migration is needed.
- The member picker requires the Discord bot to be in the server and have permission to view members.
