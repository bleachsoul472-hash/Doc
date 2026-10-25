import { getDb, jsonReply, readBody } from "./_mongo.mjs";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, X-Site-Admin-Key","Access-Control-Allow-Methods":"GET, PUT, OPTIONS","Cache-Control":"no-store"};
export async function handler(event){
 if(event.httpMethod==="OPTIONS")return {statusCode:204,headers,body:""};
 try{
  const db=await getDb(), col=db.collection("site_content");
  if(event.httpMethod==="GET") {const doc=await col.findOne({_id:"main"});return jsonReply(200,{ok:true,data:doc?.data||null},headers)}
  if(event.httpMethod!=="PUT")return jsonReply(405,{ok:false,error:"Method not allowed"},headers);
  const key=process.env.SITE_CONTENT_ADMIN_KEY||process.env.APPLICATIONS_ADMIN_KEY||"";
  const supplied=event.headers?.["x-site-admin-key"]||event.headers?.["X-Site-Admin-Key"]||"";
  if(!key)return jsonReply(503,{ok:false,error:"Configure SITE_CONTENT_ADMIN_KEY in Netlify"},headers);
  if(!supplied||supplied!==key)return jsonReply(401,{ok:false,error:"Admin key is incorrect"},headers);
  const data=readBody(event).data;
  if(!data||typeof data!=="object"||Array.isArray(data))return jsonReply(400,{ok:false,error:"Invalid site content"},headers);
  if(JSON.stringify(data).length>1500000)return jsonReply(413,{ok:false,error:"Content too large; use image URLs"},headers);
  await col.updateOne({_id:"main"},{$set:{data,updatedAt:new Date()}},{upsert:true});
  return jsonReply(200,{ok:true,saved:true},headers);
 }catch(e){console.error("content function",e);return jsonReply(503,{ok:false,error:"MongoDB connection failed. Check MONGODB_URI and Atlas network access."},headers)}
}
