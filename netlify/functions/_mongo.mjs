import { MongoClient } from "mongodb";
let clientPromise;
export async function getDb(){
  const uri=process.env.MONGODB_URI;
  if(!uri) throw new Error("MONGODB_URI is not configured in Netlify");
  if(!clientPromise){const client=new MongoClient(uri,{serverSelectionTimeoutMS:8000});clientPromise=client.connect().catch(e=>{clientPromise=null;throw e;});}
  const client=await clientPromise;
  return client.db(process.env.MONGODB_DB_NAME||"ms3dh");
}
export function jsonReply(statusCode,body,headers={}){return {statusCode,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store, max-age=0","access-control-allow-origin":"*",...headers},body:JSON.stringify(body)}}
export function readBody(event){try{return JSON.parse(event.body||"{}")}catch{return {}}}
