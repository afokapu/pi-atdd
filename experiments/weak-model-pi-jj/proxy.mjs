import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const result = process.env.PROXY_LOG_PATH || "/tmp/pi-model-requests.jsonl";
mkdirSync(join(result, ".."), { recursive:true });
const server=createServer(async(req,res)=>{
  try{
    if(req.url==="/health"){res.writeHead(200);res.end("ok");return}
    const chunks=[];
    for await (const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    let parsed={};
    try{parsed=JSON.parse(body.toString("utf8"))}catch{}
    appendFileSync(result,JSON.stringify({
      method:req.method,url:req.url,model:parsed.model,
      max_tokens:parsed.max_tokens,max_completion_tokens:parsed.max_completion_tokens,
      max_output_tokens:parsed.max_output_tokens,
      temperature:parsed.temperature,stream:parsed.stream,
      messages:parsed.messages?.length,tools:parsed.tools?.length,
      top_keys:Object.keys(parsed).sort()
    })+"\n");
    const upstream=await fetch("http://127.0.0.1:8080"+req.url,{
      method:req.method,headers:{"content-type":"application/json"},body
    });
    res.writeHead(upstream.status,{
      "content-type":upstream.headers.get("content-type")||"text/event-stream",
      "cache-control":"no-cache"
    });
    if(upstream.body)for await (const part of upstream.body)res.write(part);
    res.end();
  }catch(e){
    res.writeHead(502,{"content-type":"application/json"});
    res.end(JSON.stringify({error:"local diagnostic proxy failed"}));
  }
});
server.listen(8081,"127.0.0.1",()=>console.log("Local Pi model diagnostics proxy ready"));
