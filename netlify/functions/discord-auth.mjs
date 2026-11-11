import crypto from 'node:crypto';

const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8', ...headers}});
const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : '') || process.env[k] || '';
const cookie = (name, value, maxAge, extra='') => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}${extra}`;
const b64 = (v) => Buffer.from(v).toString('base64url');
const sign = (v) => crypto.createHmac('sha256', env('NOX_SESSION_SECRET')).update(v).digest('base64url');
function makeToken(payload){const body=b64(JSON.stringify(payload));return `${body}.${sign(body)}`}
function verifyToken(token){try{const [body,sig]=token.split('.');const expected=sign(body);if(!body||!sig||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const p=JSON.parse(Buffer.from(body,'base64url').toString());if(p.exp<Date.now())return null;return p}catch{return null}}
function getCookie(req,name){return (req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}
async function discord(path, token){const r=await fetch(`https://discord.com/api/v10${path}`,{headers:{Authorization:`Bot ${token}`}});if(!r.ok)throw new Error(`Discord API ${r.status}`);return r.json()}
async function getMember(userId){const bot=env('DISCORD_BOT_TOKEN'),guild=env('DISCORD_GUILD_ID');if(!bot||!guild)throw new Error('Discord bot configuration missing');const [member,roles]=await Promise.all([discord(`/guilds/${guild}/members/${userId}`,bot),discord(`/guilds/${guild}/roles`,bot)]);const byId=new Map(roles.map(r=>[r.id,r.name]));return (member.roles||[]).map(id=>({id,name:byId.get(id)||'Role'}))}
export default { async handler(event){
 const req=new Request(event.rawUrl||`https://${event.headers.host}${event.path}`,{method:event.httpMethod,headers:event.headers});
 const url=new URL(req.url), action=url.searchParams.get('action')||'me';
 const client=env('DISCORD_CLIENT_ID'),secret=env('DISCORD_CLIENT_SECRET'),redirect=env('DISCORD_REDIRECT_URI'),guild=env('DISCORD_GUILD_ID');
 if(action==='login'){
  if(!client||!secret||!redirect)return new Response('Discord OAuth is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI.',{status:503});
  const state=crypto.randomBytes(24).toString('hex');
  const target=new URL('https://discord.com/oauth2/authorize');target.searchParams.set('client_id',client);target.searchParams.set('redirect_uri',redirect);target.searchParams.set('response_type','code');target.searchParams.set('scope','identify');target.searchParams.set('state',state);
  return new Response(null,{status:302,headers:{location:target.toString(),'set-cookie':cookie('nox_oauth_state',state,600)}});
 }
 if(action==='callback'){
  const state=url.searchParams.get('state')||'', saved=getCookie(req,'nox_oauth_state'),code=url.searchParams.get('code');
  if(!state||!saved||state!==saved||!code)return new Response('Discord login could not be verified. Please try again.',{status:400});
  const form=new URLSearchParams({client_id:client,client_secret:secret,grant_type:'authorization_code',code,redirect_uri:redirect});
  const tokenRes=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
  if(!tokenRes.ok)return new Response('Discord token exchange failed.',{status:502});
  const token=await tokenRes.json();const meRes=await fetch('https://discord.com/api/v10/users/@me',{headers:{authorization:`Bearer ${token.access_token}`}});if(!meRes.ok)return new Response('Could not read Discord profile.',{status:502});
  const user=await meRes.json();let roles=[];try{roles=await getMember(user.id)}catch(e){console.error(e.message)}
  const adminIds=(env('NOX_ADMIN_ROLE_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean);
  const isAdmin=roles.some(r=>adminIds.includes(r.id));
  const session=makeToken({id:user.id,username:user.username,global_name:user.global_name||user.username,avatar:user.avatar,roles,isAdmin,exp:Date.now()+6*60*60*1000});
  const site=env('SITE_URL')||'/';const h=new Headers({location:site});h.append('set-cookie',cookie('nox_session',session,21600));h.append('set-cookie',cookie('nox_oauth_state','',0));return new Response(null,{status:302,headers:h});
 }
 if(action==='logout'){const h=new Headers({'content-type':'application/json; charset=utf-8'});h.append('set-cookie',cookie('nox_session','',0));return new Response(JSON.stringify({ok:true}),{status:200,headers:h});}
 const session=verifyToken(getCookie(req,'nox_session'));if(!session)return json({authenticated:false});
 if(action==='members'){
  try{
   session.roles=await getMember(session.id);
   const adminIds=(env('NOX_ADMIN_ROLE_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean);
   if(!session.roles.some(r=>adminIds.includes(r.id)))return json({error:'غير مصرح'},403);
   const bot=env('DISCORD_BOT_TOKEN'),roles=await discord(`/guilds/${guild}/roles`,bot),roleMap=new Map(roles.map(r=>[r.id,r.name]));
   let all=[],after='';
   for(let page=0;page<5;page++){
    const path=`/guilds/${guild}/members?limit=1000${after?`&after=${after}`:''}`;
    const batch=await discord(path,bot);if(!batch.length)break;all=all.concat(batch);after=batch[batch.length-1].user.id;if(batch.length<1000)break;
   }
   const members=all.filter(m=>!m.user.bot).map(m=>({id:m.user.id,username:m.user.username,displayName:m.nick||m.user.global_name||m.user.username,avatar:m.user.avatar?`https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=128`:`https://cdn.discordapp.com/embed/avatars/${Number(m.user.discriminator||0)%5}.png`,roles:(m.roles||[]).map(id=>({id,name:roleMap.get(id)||'Role'}))}));
   return json({members});
  }catch(e){console.error(e);return json({error:'تعذر تحميل أعضاء Discord: '+e.message},502)}
 }

 // Refresh membership/roles so permission changes are reflected without waiting for a new login.
 try{session.roles=await getMember(session.id)}catch(e){console.error(e.message)}
 const adminIds=(env('NOX_ADMIN_ROLE_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean);session.isAdmin=session.roles.some(r=>adminIds.includes(r.id));
 return json({authenticated:true,user:{id:session.id,username:session.username,displayName:session.global_name,avatar:session.avatar?`https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=128`:null,roles:session.roles,isAdmin:session.isAdmin}});
 }};
