import { createClient } from "jsr:@supabase/supabase-js@2";

const SHCS_OWNER = "53e168e4-72aa-418e-812a-6caaf315a205";
const WANN_OWNER = "1f1dd73b-cfa9-47d3-855b-f1d58283885f";
const WANN_URL = "https://txrxzsrjqwhvjosutotp.supabase.co";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info" };
const respond = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return respond({error:"Method not allowed"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL");
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const wannKey=Deno.env.get("WANN_OS_SERVICE_ROLE_KEY");
    if(!url||!key||!wannKey)throw Error("Sync configuration missing");
    const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
    if(!token)return respond({error:"Sign in required"},401);
    const source=createClient(url,key,{auth:{persistSession:false}});
    const {data:{user},error:authError}=await source.auth.getUser(token);
    if(authError||!user||user.id!==SHCS_OWNER)return respond({error:"Not authorized"},403);
    const {data:settings,error:readError}=await source.from("pilot_settings").select("product_lines").eq("user_id",SHCS_OWNER).maybeSingle();
    if(readError)throw readError;
    const defaults=[
      {key:"weekly_cake",label:"Weekly Surprise Cake",active:true},
      {key:"chiffon",label:"딸기·카카오 시폰 케이크",active:true},
      {key:"confectionery",label:"컨펙셔너리 박스",active:true}
    ];
    const raw=Array.isArray(settings?.product_lines)&&settings.product_lines.length?settings.product_lines:defaults;
    const lines=raw.filter((v:unknown):v is {key:string;label:string;active?:boolean}=>{
      if(!v||typeof v!=="object")return false;
      const x=v as Record<string,unknown>;
      return typeof x.key==="string"&&/^[a-z0-9_]+$/.test(x.key)&&typeof x.label==="string"&&x.label.trim().length>0&&x.label.length<=100;
    });
    if(lines.length!==raw.length||lines.length>100)return respond({error:"Invalid Product Lines configuration"},400);
    const wann=createClient(WANN_URL,wannKey,{auth:{persistSession:false}});
    const {data:existing,error:listError}=await wann.from("planner_product_lines").select("key,launch_date").eq("user_id",WANN_OWNER);
    if(listError)throw listError;
    const launch=new Map((existing??[]).map((x:{key:string;launch_date:string|null})=>[x.key,x.launch_date]));
    const values=lines.map((line,i)=>({
      user_id:WANN_OWNER,key:line.key,label:line.label.trim(),active:line.active!==false,
      sort_order:i,launch_date:launch.get(line.key)??null,updated_at:new Date().toISOString()
    }));
    const {error:upsertError}=await wann.from("planner_product_lines").upsert(values,{onConflict:"user_id,key"});
    if(upsertError)throw upsertError;
    const removed=(existing??[]).filter((x:{key:string})=>!lines.some(y=>y.key===x.key)).map((x:{key:string})=>x.key);
    if(removed.length){
      const {error:deactivateError}=await wann.from("planner_product_lines").update({active:false}).eq("user_id",WANN_OWNER).in("key",removed);
      if(deactivateError)throw deactivateError;
    }
    return respond({ok:true,synced:values.length,inactive:removed.length});
  }catch(e){console.error("product line sync",e);return respond({error:e instanceof Error?e.message:"Sync failed"},500);}
});
