import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const client = fileURLToPath(new URL("../scripts/acp-panel-client.mjs", import.meta.url));
const fake = `
import readline from 'node:readline';
import fs from 'node:fs';
const cfg=JSON.parse(process.env.FAKE_CONFIG);let options=[{id:'model',currentValue:'default',options:[{value:'chosen'}]},{id:cfg.effortId||'effort',currentValue:'medium',options:[{value:'high'}]},{id:'mode',currentValue:'write',options:[{value:'read-only'}]}];
if(cfg.noMode) options=options.filter(o=>o.id!=='mode');
if(cfg.noEffort) options=options.filter(o=>!o.id.includes('effort'));
if(cfg.unsupported) options[0].options=[];
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
const log=m=>fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify(m)+'\\n');
let next=1000;const waiting=new Map();
const ask=(method,params)=>new Promise(resolve=>{const id=next++;waiting.set(id,resolve);send({id,method,params});});
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);log(m);
 if(cfg.deaf)return;
 if(m.method==='session/cancel'&&cfg.honorCancel&&cfg.promptId)return send({id:cfg.promptId,result:{stopReason:'cancelled'}});
 if(!m.method){waiting.get(m.id)?.(m);return;}
 if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:cfg.protocol||1,agentInfo:{name:cfg.codex?'codex-acp':'fake-agent'}}});
 if(m.method==='session/new')return send({id:m.id,result:{sessionId:'s',configOptions:options}});
 if(m.method==='session/set_config_option'){
  options=options.map(o=>o.id===m.params.configId?{...o,currentValue:m.params.value}:o);
  if(cfg.resetModel && m.params.configId==='mode')options[0].currentValue='default';
  const echoed=cfg.echo==='missing'?{}:{configOptions:cfg.echo==='malformed'?{}:options.map(o=>cfg.echo==='wrong'&&o.id===m.params.configId?{...o,currentValue:'wrong'}:o)};
  return send({id:m.id,result:echoed});
 }
 if(m.method==='session/prompt'){
  if(cfg.honorCancel)cfg.promptId=m.id;
  if(cfg.silent)return;
  if(cfg.hard){setInterval(()=>send({method:"session/update",params:{sessionId:"s",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"."}}}}),300);return;}
  const results=[];
  for(const request of cfg.requests||[])results.push(await ask(request.method,request.params));
  if(cfg.mutate)fs.writeFileSync('tracked.txt','changed');
  const chunk=text=>send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  const finish=()=>{chunk(JSON.stringify({results,options})+(cfg.noVerdict?'':'\\nVERDICT: A'));send({id:m.id,result:{stopReason:cfg.cancelled?'cancelled':'end_turn'}});};
  if(cfg.chatty){const timer=setInterval(()=>chunk('.'),300);setTimeout(()=>{clearInterval(timer);finish();},1800);}else finish();
 }
});
`;
function run(
  config = {},
  flags = [],
  prepare = () => {},
  runtime = process.execPath,
  clientPath = client,
) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-review-"));
  const root = join(dir, "repo");
  mkdirSync(root);
  writeFileSync(join(dir, "fake.mjs"), fake);
  writeFileSync(join(dir, "prompt.md"), "Review the supplied scope.");
  writeFileSync(join(root, "inside.txt"), "inside");
  const launchRoot = prepare(root, dir) || root;
  for (const request of config.requests || [])
    if (request.params?.path === "OUTSIDE_ABSOLUTE") request.params.path = join(dir, "outside.txt");
  try {
    const out = config.outInRoot ? join(root, "answer.txt") : join(dir, "out.txt"),
      log = join(dir, "log.jsonl");
    const result = spawnSync(
      runtime,
      [
        clientPath,
        JSON.stringify([process.execPath, join(dir, "fake.mjs")]),
        join(dir, "prompt.md"),
        out,
        launchRoot,
        "--verdict",
        "VERDICT:",
        ...flags,
      ],
      {
        env: { ...process.env, FAKE_CONFIG: JSON.stringify(config), FAKE_LOG: log },
        encoding: "utf8",
        timeout: config.hard ? 75000 : 12000,
      },
    );
    assert.ifError(result.error);
    return {
      code: result.status,
      text: existsSync(out) ? readFileSync(out, "utf8") : "",
      error: result.stderr,
      log: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [],
      unexpected: existsSync(join(root, "terminal-ran")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("rejects hostile terminals, writes and every permission kind while allowing confined reads", () => {
  const requests = [
    { method: "fs/read_text_file", params: { path: "inside.txt" } },
    { method: "terminal/create", params: { command: "git", args: ["reset", "--hard"] } },
    {
      method: "terminal/create",
      params: {
        command: process.execPath,
        args: ["-e", "require('fs').writeFileSync('terminal-ran','bad')"],
      },
    },
    { method: "fs/write_text_file", params: { path: "inside.txt", content: "bad" } },
    ...["read", "execute", "edit", "unknown"].map((kind) => ({
      method: "session/request_permission",
      params: {
        toolCall: { kind },
        options: [
          { kind: "allow_once", optionId: "allow" },
          { kind: "reject_once", optionId: "reject" },
        ],
      },
    })),
    {
      method: "session/request_permission",
      params: { options: [{ kind: "allow_once", optionId: "allow" }] },
    },
  ];
  const r = run({ requests });
  assert.equal(r.code, 0);
  assert.equal(r.unexpected, false);
  assert.equal(r.log[0].params.clientCapabilities.terminal, false);
  const result = JSON.parse(r.text.split("\n")[0]).results;
  assert.equal(result[0].result.content, "inside");
  for (const response of result.slice(1, 4)) assert.ok(response.error);
  for (const response of result.slice(4, 8))
    assert.equal(response.result.outcome.optionId, "reject");
  assert.equal(result[8].result.outcome.outcome, "cancelled");
});
test("rejects traversal, outside absolute paths and escaped file/parent symlinks", (t) => {
  try {
    const r = run(
      {
        requests: [
          "../outside.txt",
          "OUTSIDE_ABSOLUTE",
          "outside-link",
          "parent-link/outside.txt",
          "inside-link",
        ].map((path) => ({ method: "fs/read_text_file", params: { path } })),
      },
      [],
      (root, dir) => {
        writeFileSync(join(dir, "outside.txt"), "secret");
        symlinkSync(join(dir, "outside.txt"), join(root, "outside-link"), "file");
        symlinkSync(dir, join(root, "parent-link"), "dir");
        symlinkSync(join(root, "inside.txt"), join(root, "inside-link"), "file");
      },
    );
    assert.equal(r.code, 0);
    const results = JSON.parse(r.text.split("\n")[0]).results;
    results.slice(0, 4).forEach((row) => assert.ok(row.error));
    assert.equal(results[4].result.content, "inside");
  } catch (e) {
    if (e.code === "EPERM") t.skip("Native symlink creation unavailable");
    else throw e;
  }
});
for (const effortId of ["effort", "reasoning_effort"])
  test("confirms requested model and " + effortId + " plus Codex read-only mode", () => {
    const r = run({ codex: true, effortId }, ["--model", "chosen", "--effort", "high"]);
    assert.equal(r.code, 0);
    assert.match(r.text, /"currentValue":"read-only"/);
    assert.match(r.text, /"currentValue":"chosen"/);
  });
for (const config of [
  { noMode: true, codex: true },
  { noEffort: true },
  { unsupported: true },
  ...["missing", "wrong", "malformed"].map((echo) => ({ echo })),
  { resetModel: true },
  { protocol: 2 },
])
  test("refuses unverifiable setup " + JSON.stringify(config), () => {
    const r = run(config, ["--model", "chosen", "--effort", "high"]);
    assert.equal(r.code, 1);
    assert.equal(
      r.log.some((m) => m.method === "session/prompt"),
      false,
    );
    assert.equal(r.text, "");
  });
test("max-turns bounds incomplete verdicts and permission-cancelled continuation", () => {
  const r = run(
    {
      noVerdict: true,
      cancelled: true,
      requests: [{ method: "session/request_permission", params: { options: [] } }],
    },
    ["--max-turns", "2"],
  );
  assert.equal(r.code, 3);
  assert.equal(r.log.filter((m) => m.method === "session/prompt").length, 2);
});
test("preserves workspace-change exit status", () => {
  const r = run({ mutate: true }, [], (root) => {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    writeFileSync(join(root, "tracked.txt"), "before");
    assert.equal(spawnSync("git", ["-C", root, "add", "tracked.txt"]).status, 0);
  });
  assert.equal(r.code, 4);
});
test("idle deadline cancels and reaps a silent adapter", () => {
  const r = run({ silent: true }, ["--idle-min", "0.01"]);
  assert.equal(r.code, 124);
  assert.match(r.error, /IDLE TIMEOUT/);
});
test("idle deadline also covers an adapter that never answers initialize", () => {
  const r = run({ deaf: true }, ["--idle-min", "0.01"]);
  assert.equal(r.code, 124);
  assert.match(r.error, /IDLE TIMEOUT/);
});
test("a deadline stays exit 124 when the adapter honors the cancel", () => {
  const r = run({ silent: true, honorCancel: true }, ["--idle-min", "0.01"]);
  assert.equal(r.code, 124);
  assert.match(r.error, /IDLE TIMEOUT/);
});
test("an answer file inside the review root is not a workspace change", () => {
  const r = run({ outInRoot: true }, [], (root) => {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  });
  assert.equal(r.code, 0);
  assert.match(r.text, /VERDICT:/);
});
test("streaming activity renews idle deadline", () => {
  const r = run({ chatty: true }, ["--idle-min", "0.01"]);
  assert.equal(r.code, 0);
  assert.match(r.text, /VERDICT:/);
});
test("copied standalone helper runs without its source checkout", () => {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-copy-"));
  try {
    const copy = join(dir, "client.mjs");
    writeFileSync(copy, readFileSync(client));
    const r = run({ codex: true }, ["--model", "chosen"], () => {}, process.execPath, copy);
    assert.equal(r.code, 0);
    assert.match(r.text, /VERDICT:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "hard deadline stops a streaming adapter independently of idle activity",
  { timeout: 75000 },
  () => {
    const r = run({ hard: true }, ["--timeout-min", "1", "--idle-min", "5"]);
    assert.equal(r.code, 124);
    assert.match(r.error, /HARD TIMEOUT/);
  },
);
test("canonicalizes a caller root alias before reading", (t) => {
  try {
    const r = run(
      { requests: [{ method: "fs/read_text_file", params: { path: "inside.txt" } }] },
      [],
      (root, dir) => {
        const alias = join(dir, "root-alias");
        symlinkSync(root, alias, "dir");
        return alias;
      },
    );
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.text.split("\n")[0]).results[0].result.content, "inside");
  } catch (e) {
    if (e.code === "EPERM") t.skip("Native symlink creation unavailable");
    else throw e;
  }
});
