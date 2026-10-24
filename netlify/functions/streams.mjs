const headers = {"content-type":"application/json; charset=utf-8","cache-control":"no-store, max-age=0","access-control-allow-origin":"*"};
const json=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
export async function handler(event){
  if(event.httpMethod!=="GET") return json(405,{ok:false,error:"Method not allowed"});
  const slug=String(event.queryStringParameters?.channel||"").trim().replace(/^@/,"");
  if(!/^[a-zA-Z0-9_-]{1,50}$/.test(slug)) return json(400,{ok:false,error:"Invalid channel"});
  try {
    const response=await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,{headers:{"accept":"application/json","user-agent":"Mozilla/5.0 MS3DH-TRIPE-Status/1.0"},signal:AbortSignal.timeout(8000)});
    if(!response.ok) return json(response.status===404?200:502,{ok:true,channel:slug,live:false,verified:response.status===404});
    const data=await response.json();
    const live=!!(data?.livestream && (data.livestream.is_live===true || data.livestream.id || data.livestream.session_title));
    return json(200,{ok:true,channel:slug,live,verified:true,title:data?.livestream?.session_title||"",viewers:Number(data?.livestream?.viewer_count||0)});
  } catch(error){ return json(502,{ok:false,channel:slug,live:false,verified:false,error:"Could not verify Kick status"}); }
}
