/* eslint-disable prettier/prettier -- formatting to be normalized in follow-up */
// Planner owns shopping tasks; PILOT is a live, authenticated remote client.
// No replicated shopping records are stored in PILOT.
import { createClient } from "jsr:@supabase/supabase-js@2";
const WANN_URL = "https://txrxzsrjqwhvjosutotp.supabase.co";
const OWNER = "53e168e4-72aa-418e-812a-6caaf315a205";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const dateOk=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+"T12:00:00Z"));
const idOk=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return respond({error:"method_not_allowed"},405);
 try {
  const auth=req.headers.get("Authorization")??"";
  const token=auth.replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),wannKey=Deno.env.get("WANN_OS_SERVICE_ROLE_KEY");
  if(!url||!key||!wannKey)return respond({error:"not_configured"},503);
  const kora=createClient(url,key);
  const {data:{user},error:authError}=await kora.auth.getUser(token);
  if(authError||user?.id!==OWNER)return respond({error:"unauthorized"},401);
  const wann=createClient(WANN_URL,wannKey);
  const {data:link,error:linkError}=await wann.from("integration_links").select("planner_user_id").eq("source","pilot").single();
  if(linkError||!link?.planner_user_id)return respond({error:"planner_link_unavailable"},503);
  const uid=link.planner_user_id;
  const body=await req.json().catch(()=>({}));
  const action=body?.action??"list";
  if(action==="list"){
   const {data,error}=await wann.from("planner_tasks").select("id,title,due_date,completed,recurrence,shopping_order,shopping_type,created_at").eq("user_id",uid).eq("is_shopping",true).order("shopping_order",{ascending:true}).order("created_at",{ascending:true}).limit(500);
   if(error)return respond({error:"planner_read_failed"},502);
   // Recurring shopping tasks retain Planner's per-occurrence completion semantics.
   const recurring=(data??[]).filter(t=>t.recurrence!=="none").map(t=>t.id);
   let completedDates:{task_id:string;occurrence_date:string}[]=[];
   if(recurring.length){
    const {data:done,error:doneError}=await wann.from("planner_task_completions").select("task_id,occurrence_date").eq("user_id",uid).in("task_id",recurring).limit(2000);
    if(doneError)return respond({error:"planner_completion_read_failed"},502);
    completedDates=done??[];
   }
   return respond({items:data??[],completions:completedDates});
  }
  if(action==="add"){
   const title=typeof body.title==="string"?body.title.trim():"";
   if(!title||title.length>200||!dateOk(body.date))return respond({error:"invalid_input"},400);
   const {data,error}=await wann.from("planner_tasks").insert({user_id:uid,title,due_date:body.date,is_shopping:true,recurrence:"none"}).select("id").single();
   if(error)return respond({error:"planner_write_failed"},502);
   return respond({id:data.id});
  }
  if(action==="toggle"){
   if(!idOk(body.id)||!dateOk(body.date)||typeof body.completed!=="boolean")return respond({error:"invalid_input"},400);
   const {data:task,error:findError}=await wann.from("planner_tasks").select("id,recurrence").eq("user_id",uid).eq("id",body.id).eq("is_shopping",true).single();
   if(findError||!task)return respond({error:"not_found"},404);
   if(task.recurrence!=="none"){
    if(body.completed){
     const {error}=await wann.from("planner_task_completions").upsert({user_id:uid,task_id:task.id,occurrence_date:body.date},{onConflict:"task_id,occurrence_date"});
     if(error)return respond({error:"planner_write_failed"},502);
    }else{
     const {error}=await wann.from("planner_task_completions").delete().eq("user_id",uid).eq("task_id",task.id).eq("occurrence_date",body.date);
     if(error)return respond({error:"planner_write_failed"},502);
    }
   }else{
    const {error}=await wann.from("planner_tasks").update({completed:body.completed,completed_at:body.completed?new Date().toISOString():null}).eq("id",task.id).eq("user_id",uid);
    if(error)return respond({error:"planner_write_failed"},502);
   }
   return respond({ok:true});
  }
  return respond({error:"invalid_action"},400);
 }catch{return respond({error:"upstream_unavailable"},503)}
});
