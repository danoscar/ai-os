// Fixture tests for the Codex and Gemini providers (run: node dev/test-providers.js). Uses a temp dir, touches nothing real.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const T=fs.mkdtempSync(path.join(os.tmpdir(),'po-prov-')); const CODEX=path.join(T,'codex'), GEM=path.join(T,'gemini');
process.env.CODEX_HOME=CODEX; process.env.GEMINI_DIR=GEM; process.env.CLAUDE_CONFIG_DIR=path.join(T,'nonexistent');
const iso=(ms=Date.now())=>new Date(ms).toISOString();
const w=(f,lines)=>{fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,lines.map(l=>typeof l==='string'?l:JSON.stringify(l)).join('\n')+'\n');};
const ap=(f,lines)=>fs.appendFileSync(f,lines.map(l=>JSON.stringify(l)).join('\n')+'\n');
const touch=(f,ageMs)=>{const t=(Date.now()-ageMs)/1000; fs.utimesSync(f,t,t);};

// ---------- Codex: paginated session (huge session_meta) + legacy session
const U1='11111111-aaaa-bbbb-cccc-000000000001', U2='22222222-aaaa-bbbb-cccc-000000000002';
const f1=path.join(CODEX,'sessions/2026/11/06',`rollout-2026-11-06T09-00-00-${U1}.jsonl`);
w(f1,[{timestamp:iso(),type:'session_meta',payload:{id:U1,cwd:'/tmp/demo-codex',cli_version:'0.160.0',timestamp:iso(),history_mode:'paginated',base_instructions:'x'.repeat(90000)}},
 {timestamp:iso(),type:'turn_context',payload:{model:'gpt-5-codex'}},{timestamp:iso(),type:'event_msg',payload:{type:'task_started'}},
 {timestamp:iso(),type:'event_msg',payload:{type:'item_completed',item:{type:'UserMessage',id:'u0',content:[{type:'input_text',text:'<environment_context>cwd=/tmp</environment_context>'}]}}},
 {timestamp:iso(),type:'event_msg',payload:{type:'item_completed',item:{type:'UserMessage',id:'u1',content:[{type:'input_text',text:'Fix the failing test in auth.ts'}]}}},
 {timestamp:iso(),type:'event_msg',payload:{type:'item_completed',item:{type:'AgentMessage',id:'a1',content:[{type:'output_text',text:'Looking at the test first.'}]}}},
 {timestamp:iso(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,output_tokens:200},last_token_usage:{input_tokens:900}}}}]);
const f2=path.join(CODEX,'sessions/2026/11/05',`rollout-2026-11-05T22-00-00-${U2}.jsonl`);
w(f2,[{timestamp:iso(),type:'session_meta',payload:{id:U2,cwd:'/tmp/other-codex',cli_version:'0.100.0',timestamp:iso()}},
 {timestamp:iso(),type:'event_msg',payload:{type:'user_message',message:'Refactor the parser'}},
 {timestamp:iso(),type:'response_item',payload:{type:'function_call',name:'shell',call_id:'c1',arguments:JSON.stringify({command:['bash','-lc','git status']})}},
 {timestamp:iso(),type:'event_msg',payload:{type:'agent_message',message:'Parser refactored, tests pass.'}}]);
touch(f2, 3*3600e3);

// ---------- Gemini: jsonl + legacy json
const G1='aaaaaaaa-1111-2222-3333-444444444444', G2='bbbbbbbb-1111-2222-3333-444444444444';
const g1=path.join(GEM,'tmp/my-project/chats','session-2026-11-06T09-00-aaaaaaaa.jsonl');
w(g1,[{sessionId:G1,projectHash:'h1',startTime:iso(),lastUpdated:iso(),kind:'main',directories:['/tmp/demo-gemini']},
 {id:'m1',timestamp:iso(),type:'user',content:[{text:'Explain this repo'}]},
 {id:'m2',timestamp:iso(),type:'gemini',content:'It is a CLI tool.',model:'gemini-2.5-pro',tokens:{input:500,output:50,cached:0},toolCalls:[{id:'t1',name:'read_file',args:{file_path:'README.md'}}]},
 {$set:{summary:'Repo overview'}}]);
const g2=path.join(GEM,'tmp/old-proj/chats','session-2026-11-05T10-00-bbbbbbbb.json');
w(g2,[JSON.stringify({sessionId:G2,projectHash:'h2',startTime:iso(),messages:[{id:'x1',timestamp:iso(),type:'user',content:'hi there'},{id:'x2',timestamp:iso(),type:'gemini',content:'hello!',model:'gemini-2.5-flash',tokens:{input:10,output:5}}]})]);
touch(g2, 5*3600e3);


// ---------- Grok Build CLI (documented layout: sessions/<cwd key>/<session>/{summary.json,updates.jsonl}) + Grok Bot app daemon status
const GROK=path.join(T,'grok'); process.env.GROK_HOME=GROK; const GB=path.join(T,'grokbot'); process.env.GROKBOT_DIR=GB;
const K1='cccccccc-1111-2222-3333-444444444444', K2='dddddddd-1111-2222-3333-444444444444';
const k1=path.join(GROK,'sessions','Users-me-demo-grok',K1);
w(path.join(k1,'summary.json'),[JSON.stringify({title:'Add dark mode',model:'grok-code-fast-1',cwd:'/tmp/demo-grok',git:{branch:'main'}})]);
w(path.join(k1,'updates.jsonl'),[{sessionUpdate:'user_message_chunk',content:{type:'text',text:'Add dark mode'},_meta:{eventId:'e1'},timestamp:iso()},
 {sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Sure, '},_meta:{eventId:'e2',model:'grok-code-fast-1'},timestamp:iso()},
 {sessionUpdate:'agent_message_chunk',content:{type:'text',text:'looking at the theme.'},_meta:{eventId:'e3'},timestamp:iso()},
 {update:{sessionUpdate:'tool_call',toolCallId:'c1',title:'Run command',kind:'execute',rawInput:{command:'npm run build'}},timestamp:iso()}]);
const k2=path.join(GROK,'sessions',encodeURIComponent('/tmp/key-proj'),K2);          // no cwd in summary → taken from the key
w(path.join(k2,'summary.json'),[JSON.stringify({title:'Old chat'})]); w(path.join(k2,'updates.jsonl'),[{sessionUpdate:'user_message_chunk',content:{text:'hello'}}]); touch(path.join(k2,'updates.jsonl'),4*3600e3);
fs.mkdirSync(GB,{recursive:true}); fs.writeFileSync(path.join(GB,'local-exec-daemon.json'),JSON.stringify({pid:process.pid,startedAt:Date.now()-60000,servingAt:Date.now(),inflightCount:2,generation:0}));
fs.writeFileSync(path.join(GB,'local-exec-daemon-credential.json'),'{"sealed":"DO-NOT-READ"}'); fs.writeFileSync(path.join(GB,'settings.json'),'{"secret":"DO-NOT-READ"}');
const { createObserver } = require(path.join(__dirname,'..','observer'));
const o=createObserver(); let r=o.read();
const by=id=>r.sessions.find(s=>s.id===id);
const cx1=by('cx-11111111'), cx2=by('cx-22222222'), gm1=by('gm-aaaaaaaa'), gm2=by('gm-bbbbbbbb');
console.log(r.sessions.map(s=>`${s.provider}:${s.id} ${s.project} [${s.sleeping?'sleeping':s.status}] "${s.name}" ${s.model} act="${s.activity&&s.activity.text}"`).join('\n'));
assert(cx1&&cx2&&gm1&&gm2,'all four sessions found');
assert.strictEqual(cx1.project,'demo-codex'); assert.strictEqual(cx1.status,'working'); assert.strictEqual(cx1.sleeping,false);
assert.strictEqual(cx1.name,'Fix the failing test in auth.ts','injected <environment_context> prompt must be ignored');
assert.strictEqual(cx1.model,'gpt-5-codex'); assert.strictEqual(cx1.ctx,900);
assert.strictEqual(cx2.sleeping,true); assert.strictEqual(cx2.name,'Refactor the parser'); assert(/shell: bash -lc git status/.test(cx2.activity.text)||/Parser refactored/.test(cx2.activity.text));
assert.strictEqual(gm1.project,'demo-gemini'); assert.strictEqual(gm1.name,'Repo overview'); assert.strictEqual(gm1.model,'gemini-2.5-pro'); assert.strictEqual(gm1.status,'working');
assert.strictEqual(gm2.sleeping,true); assert.strictEqual(gm2.project,'old-proj'); assert.strictEqual(gm2.model,'gemini-2.5-flash');
// incremental counting: first read counts nothing, appended lines do
assert.strictEqual(cx1.tokens,0); assert.strictEqual(gm1.tokens,0);
ap(f1,[{timestamp:iso(),type:'event_msg',payload:{type:'item_completed',item:{type:'CommandExecution',id:'k1',command:['bash','-lc','npm test']}}},{timestamp:iso(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1800,output_tokens:300}}}}]);
ap(g1,[{id:'m3',timestamp:iso(),type:'gemini',content:'',model:'gemini-2.5-pro',tokens:{input:700,output:80},toolCalls:[{id:'t2',name:'run_shell_command',args:{command:'ls -la'}}]}]);
r=o.read();
const a=by('cx-11111111'), b=by('gm-aaaaaaaa');
assert.strictEqual(a.tokens,900,'codex: cumulative total minus base (1800+300 - 1000+200)'); assert.strictEqual(a.tools,1); assert(/shell: bash -lc npm test/.test(a.activity.text));
assert.strictEqual(b.tokens,780); assert.strictEqual(b.tools,1); assert(/run_shell_command: ls -la/.test(b.activity.text));
// ---------- Grok assertions
const gk1=by('gk-cccccccc'), gk2=by('gk-dddddddd'), gb=by('gb-app');
assert(gk1&&gk2&&gb,'grok sessions found');
assert.strictEqual(gk1.project,'demo-grok'); assert.strictEqual(gk1.name,'Add dark mode'); assert.strictEqual(gk1.model,'grok-code-fast-1'); assert.strictEqual(gk1.status,'working');
assert(/Run command: npm run build/.test(gk1.activity.text),'enveloped tool_call parsed: '+JSON.stringify(gk1.activity));
assert.strictEqual(gk2.sleeping,true); assert.strictEqual(gk2.project,'key-proj','project taken from the URL-encoded key');
assert.strictEqual(gb.provider,'grokbot'); assert.strictEqual(gb.status,'working'); assert.strictEqual(gb.pid,process.pid); assert(/2 local tasks in flight/.test(gb.activity.text));
fs.writeFileSync(path.join(GB,'local-exec-daemon.json'),JSON.stringify({pid:process.pid,startedAt:Date.now()-60000,servingAt:Date.now(),inflightCount:0}));
r=o.read(); assert.strictEqual(by('gb-app').status,'idle');
assert(!JSON.stringify(r).includes('DO-NOT-READ'),'grokbot credential/settings files must never be read');
const gm=o.messages('gk-cccccccc'); console.log('grok msgs:',gm.map(m=>m.r+':'+m.t.slice(0,32)).join(' | '));
assert(gm.some(m=>m.r==='assistant'&&m.t==='Sure, looking at the theme.'),'agent chunks are coalesced'); assert.strictEqual(o.messages('gb-app'),null);
assert.strictEqual(o.lookup('gk-cccccccc').provider,'grok'); assert.strictEqual(o.lookup('gb-app').provider,'grokbot');
// conversation view for the chat panel (read-only for these providers)
const m1=o.messages('cx-11111111'), m2=o.messages('gm-aaaaaaaa'), m3=o.messages('cx-22222222'), m4=o.messages('gm-bbbbbbbb');
console.log('codex msgs:',m1.map(m=>m.r+':'+m.t.slice(0,30)).join(' | ')); console.log('gemini msgs:',m2.map(m=>m.r+':'+m.t.slice(0,30)).join(' | '));
assert(m1.some(m=>m.r==='user'&&/Fix the failing/.test(m.t))&&!m1.some(m=>/environment_context/.test(m.t)));
assert(m2.some(m=>m.r==='tool')&&m2.some(m=>m.r==='assistant'));
assert(m3.length>=2 && m4.length===2);
assert.strictEqual(o.lookup('cx-11111111').provider,'codex'); assert.strictEqual(o.lookup('gm-aaaaaaaa').provider,'gemini');
// secrets are masked
ap(f1,[{timestamp:iso(),type:'event_msg',payload:{type:'item_completed',item:{type:'CommandExecution',id:'k2',command:'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://x.io'}}}]);
r=o.read(); assert(!/abcdefghijklmnop1234/.test(by('cx-11111111').activity.text),'secret leaked'); 
console.log('\nALL PROVIDER TESTS PASSED'); if (process.env.PO_KEEP) console.log('fixtures kept in', T); else fs.rmSync(T,{recursive:true,force:true});
