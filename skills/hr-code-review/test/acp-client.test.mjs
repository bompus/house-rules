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
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const client = fileURLToPath(new URL("../scripts/acp-panel-client.mjs", import.meta.url));
const fake = `
import readline from 'node:readline';
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
const cfg=JSON.parse(process.env.FAKE_CONFIG);let options=[{id:'model',currentValue:'default',options:[{value:'chosen'}]},{id:cfg.effortId||'effort',currentValue:'medium',options:[{value:'high'}]},{id:'mode',currentValue:cfg.modeStart||'write',options:(cfg.modes||['read-only']).map(value=>({value}))}];
const launch={pid:process.pid,argv:process.argv.slice(2),env:Object.keys(process.env),codexPath:process.env.CODEX_PATH??null,realCodex:process.env.CODEX_NO_WEB_REAL??null,codexConfig:process.env.CODEX_CONFIG??null};
const argAt=process.argv.indexOf('--config');
if(argAt>=0){const file=process.argv[argAt+1];launch.devin={file,config:JSON.parse(fs.readFileSync(file,'utf8')),fileMode:fs.statSync(file).mode&0o777,dirMode:fs.statSync(file.slice(0,Math.max(file.lastIndexOf('/'),file.lastIndexOf('\\\\')))).mode&0o777};}
if(launch.codexPath&&fs.existsSync(launch.codexPath)&&launch.codexPath.endsWith('codex-no-web'))launch.wrapper=fs.readFileSync(launch.codexPath,'utf8');
fs.writeFileSync(process.env.FAKE_LOG+'.launch',JSON.stringify(launch));
if(cfg.stderrLine)process.stderr.write(cfg.stderrLine+'\\n');
if(cfg.ignoreTerm)process.on('SIGTERM',()=>{});
if(cfg.linger)setInterval(()=>{},1000);
if(cfg.errorOnTerm)process.on('SIGTERM',()=>{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:cfg.promptId,error:{code:-32800,message:'cancelled'}})+'\\n');setTimeout(()=>process.exit(0),300);});
if(cfg.helperHolds)spawn('sleep',['6'],{stdio:['ignore','inherit','inherit'],detached:true}).unref();
if(cfg.modelValues) options[0].options=cfg.modelValues.map(value=>({value}));
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
 if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:cfg.protocol||1,agentInfo:{name:cfg.agentName||(cfg.codex?'codex-acp':'fake-agent'),title:cfg.agentTitle}}});
 if(m.method==='session/new'){if(cfg.helperExit){spawn('sleep',['4'],{stdio:['ignore','inherit','inherit'],detached:true}).unref();process.exit(3);}
  if(cfg.dieOnNew)process.exit(3);return send({id:m.id,result:{sessionId:'s',configOptions:options}});}
 if(m.method==='session/set_config_option'){
  options=options.map(o=>o.id===m.params.configId?{...o,currentValue:m.params.value}:o);
  if(cfg.resetModel && m.params.configId==='mode')options[0].currentValue='default';
  const echoed=cfg.echo==='missing'?{}:{configOptions:cfg.echo==='malformed'?{}:options.map(o=>cfg.echo==='wrong'&&o.id===m.params.configId?{...o,currentValue:'wrong'}:cfg.echoModel&&o.id==='model'?{...o,currentValue:cfg.echoModel}:o)};
  return send({id:m.id,result:echoed});
 }
 if(m.method==='session/prompt'){
  if(cfg.honorCancel||cfg.errorOnTerm)cfg.promptId=m.id;
  if(cfg.silent)return;
  if(cfg.hard){setInterval(()=>send({method:"session/update",params:{sessionId:"s",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"."}}}}),300);return;}
  const results=[];
  for(const request of cfg.requests||[])results.push(await ask(request.method,request.params));
  for(let i=0;i<(cfg.objectIdFlood||0);i++){const pad='p'.repeat(1<<20);results.push(await ask('session/request_permission',{toolCall:{kind:{padding:pad},toolCallId:{padding:pad}},options:[{kind:'reject_once',optionId:'reject'}]}));}
  if(cfg.mutate)fs.writeFileSync('tracked.txt','changed');
  if(cfg.symlinkAnswer)fs.symlinkSync(process.env.FAKE_OUTSIDE,'answer.txt');
  if(cfg.hardlinkAnswer)fs.linkSync(process.env.FAKE_OUTSIDE,'answer.txt');
  if(cfg.lateOverflow){const chunkLine=text=>JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
   for(let i=0;i<31;i++)send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'.repeat(1<<20)}}}});
   process.stdout.write(chunkLine('x'.repeat((1<<20)-11)+'\\nVERDICT: A')+'\\n'+JSON.stringify({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}})+'\\n'+chunkLine('y')+'\\n');
   return;}
  if(cfg.newlineFlood){for(let i=0;i<32;i++)process.stdout.write('\\n'.repeat(1<<16));}
  if(cfg.bigLine){process.stdout.write('x'.repeat(cfg.bigLine));await new Promise(r=>setTimeout(r,200));}
  for(let i=0;i<(cfg.bigChunks||0);i++)send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'x'.repeat(1<<20)}}}});
  if(cfg.manyTools)process.stdout.write(Array.from({length:cfg.manyTools},(_,i)=>JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'tool_call',toolCallId:'t'+i,kind:'read',status:'pending'}}})).join('\\n')+'\\n');
  for(const f of cfg.writeFiles||[]){const d=f.slice(0,f.lastIndexOf('/')+1);if(d)fs.mkdirSync(d,{recursive:true});fs.writeFileSync(f,'written');}
  for(const f of cfg.removeFiles||[])fs.rmSync(f);
  for(const [a,b] of cfg.renameBytes||[])fs.renameSync(Buffer.from(a,'latin1'),Buffer.from(b,'latin1'));
  if(cfg.removeGit)fs.rmSync('.git',{recursive:true,force:true});
  for(const args of cfg.git||[])execFileSync('git',args);
  for(const update of cfg.toolUpdates||[])send({method:'session/update',params:{sessionId:'s',update}});
  if(cfg.afterReply)setTimeout(()=>{for(let i=0;i<34;i++)send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'z'.repeat(1<<20)}}}});},50);
  const chunk=text=>send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  const finish=()=>{chunk(JSON.stringify({results,options,env:cfg.reportEnv?Object.keys(process.env):undefined})+(cfg.noVerdict?'':'\\nVERDICT: A'));send({id:m.id,result:{stopReason:cfg.cancelled?'cancelled':'end_turn'}});};
  if(cfg.chatty){const timer=setInterval(()=>chunk('.'),100);setTimeout(()=>{clearInterval(timer);finish();},1800);}else finish();
 }
});
`;
/**
 * @param {any} config
 * @param {string[]} flags
 */
function run(
  config = {},
  flags = [],
  // Returns the directory to launch from when a test needs one other than the repo.
  prepare = /** @type {(root: string, dir: string) => string | void} */ (() => {}),
  runtime = process.execPath,
  clientPath = client,
) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-review-"));
  const root = join(dir, "repo");
  mkdirSync(root);
  writeFileSync(join(dir, "fake.mjs"), fake);
  // A launch the client identifies by a whole path segment of the script an interpreter runs.
  const fakePath = config.fakeSegment
    ? join(dir, config.fakeSegment, "fake.mjs")
    : join(dir, "fake.mjs");
  if (config.fakeSegment) {
    mkdirSync(join(dir, config.fakeSegment));
    writeFileSync(fakePath, fake);
  }
  // Executables named like the agents they stand for; they start the fake (POSIX only).
  /** @param {string} name @param {string} body */
  const shim = (name, body) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return join(dir, name);
  };
  const env = { ...config.env };
  for (const [key, value] of Object.entries(env)) {
    env[key] = String(value).replaceAll("%DIR%", dir);
  }
  flags = flags.map((flag) => flag.replaceAll("%DIR%", dir));
  if (config.codexShim) {
    env.CODEX_PATH = shim(
      "codex",
      config.codexShim === "fail"
        ? "exit 1"
        : config.codexShim === "from-cwd"
          ? // The review root's own MCP server is listed only when the command runs there.
            `if [ -e ./project-mcp ]; then echo '[{"name":"project"}]'; else echo '[]'; fi`
          : `echo '${JSON.stringify(config.codexShim)}'`,
    );
  }
  // The tests must not read the developer's own Devin config.
  if (config.devinShim && !("XDG_CONFIG_HOME" in env)) {
    env.XDG_CONFIG_HOME = join(dir, "xdg-empty");
  }
  const serverArgs = (config.serverArgs || []).map((/** @type {string} */ a) =>
    a.replaceAll("%FAKE%", fakePath),
  );
  const launcher = config.launcher || (config.devinShim ? "devin" : "");
  const server = config.serverNotFound
    ? ["definitely-missing-acp-agent"]
    : launcher
      ? [shim(launcher, `exec "${process.execPath}" "${fakePath}" "$@"`), ...serverArgs]
      : [process.execPath, fakePath, ...serverArgs];
  const outside = join(dir, "outside.txt");
  if (config.symlinkAnswer || config.hardlinkAnswer) {
    writeFileSync(outside, "keep");
    env.FAKE_OUTSIDE = outside;
  }
  writeFileSync(join(dir, "prompt.md"), "Review the supplied scope.");
  writeFileSync(join(root, "inside.txt"), "inside");
  const launchRoot = prepare(root, dir) || root;
  for (const request of config.requests || []) {
    if (request.params?.path === "OUTSIDE_ABSOLUTE") {
      request.params.path = join(dir, "outside.txt");
    }
  }
  try {
    const out = config.outInRoot ? join(root, "answer.txt") : join(dir, "out.txt"),
      log = join(dir, "log.jsonl");
    if (config.outMode !== undefined) {
      writeFileSync(out, "old", { mode: config.outMode });
      chmodSync(out, config.outMode);
    }
    const result = spawnSync(
      runtime,
      [
        clientPath,
        JSON.stringify(server),
        join(dir, "prompt.md"),
        out,
        launchRoot,
        "--verdict",
        "VERDICT:",
        ...flags,
      ],
      {
        env: {
          ...process.env,
          // The client narrows the seat's environment; the fake needs these three to run.
          ACP_PANEL_PASS_ENV: "FAKE_",
          ...config.env,
          ...env,
          FAKE_CONFIG: JSON.stringify(config),
          FAKE_LOG: log,
        },
        encoding: "utf8",
        timeout: config.killAfter ?? (config.hard ? 75000 : 12000),
        killSignal: "SIGTERM",
      },
    );
    if (config.killAfter === undefined) {
      assert.ifError(result.error);
    }
    return {
      code: result.status,
      text: existsSync(out) ? readFileSync(out, "utf8") : "",
      error: result.stderr,
      log: existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
      unexpected: existsSync(join(root, "terminal-ran")),
      outside:
        config.symlinkAnswer || config.hardlinkAnswer ? readFileSync(outside, "utf8") : undefined,
      outMode: existsSync(out) ? statSync(out).mode & 0o777 : undefined,
      // Files a test's own setup left in the run directory, read before it is removed.
      read: Object.fromEntries(
        (config.readBack || []).map((/** @type {string} */ name) => [
          name,
          existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null,
        ]),
      ),
      launch: existsSync(`${log}.launch`)
        ? JSON.parse(readFileSync(`${log}.launch`, "utf8"))
        : null,
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
  const result = JSON.parse(r.text.split("\n")[0] ?? "").results;
  assert.equal(result[0].result.content, "inside");
  for (const response of result.slice(1, 4)) {
    assert.ok(response.error);
  }
  for (const response of result.slice(4, 8)) {
    assert.equal(response.result.outcome.optionId, "reject");
  }
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
    const results = JSON.parse(r.text.split("\n")[0] ?? "").results;
    results.slice(0, 4).forEach((/** @type {any} */ row) => assert.ok(row.error));
    assert.equal(results[4].result.content, "inside");
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "EPERM") {
      t.skip("Native symlink creation unavailable");
    } else {
      throw e;
    }
  }
});
for (const effortId of ["effort", "reasoning_effort", "thought_level", "thinking_level"]) {
  test("confirms requested model and " + effortId + " plus Codex read-only mode", () => {
    const r = run({ codex: true, effortId }, ["--model", "chosen", "--effort", "high"]);
    assert.equal(r.code, 0);
    assert.match(r.text, /"currentValue":"read-only"/);
    assert.match(r.text, /"currentValue":"chosen"/);
  });
}
for (const config of [
  { noMode: true, codex: true },
  { noEffort: true },
  { unsupported: true },
  ...["missing", "wrong", "malformed"].map((echo) => ({ echo })),
  { resetModel: true },
  { protocol: 2 },
]) {
  test("refuses unverifiable setup " + JSON.stringify(config), () => {
    const r = run(config, ["--model", "chosen", "--effort", "high"]);
    assert.equal(r.code, 1);
    assert.equal(
      r.log.some((m) => m.method === "session/prompt"),
      false,
    );
    assert.equal(r.text, "");
  });
}
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
// A seat's runtime writes its own bundled skills under skills/system/ (Codex does this at session start).
const RUNTIME_SKILL = "skills/system/run-workflow/SKILL.md";
/** @param {string} root */
function gitRepoWithTracked(root) {
  assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  writeFileSync(join(root, "tracked.txt"), "before");
  assert.equal(spawnSync("git", ["-C", root, "add", "tracked.txt"]).status, 0);
}
test("an untracked skills/system file the runtime writes is not a workspace change", () => {
  const r = run({ writeFiles: [RUNTIME_SKILL] }, [], gitRepoWithTracked);
  assert.equal(r.code, 0);
  assert.match(r.text, /VERDICT:/);
  assert.doesNotMatch(r.error, /WORKSPACE CHANGED/);
});
test("any other new file is a workspace change and the log names it", () => {
  const r = run(
    { writeFiles: [RUNTIME_SKILL, "stray.txt", "skills/mine/SKILL.md"] },
    [],
    gitRepoWithTracked,
  );
  assert.equal(r.code, 4);
  assert.match(r.error, /WORKSPACE CHANGED.*skills\/mine\/SKILL\.md, stray\.txt/);
  assert.doesNotMatch(r.error, /run-workflow/);
  assert.match(r.text, /VERDICT:/);
});
test("a launch directory below the repository root has its own skills/system directory", () => {
  const prepare = (/** @type {string} */ root) => {
    gitRepoWithTracked(root);
    mkdirSync(join(root, "packages", "app"), { recursive: true });
    writeFileSync(join(root, "packages", "app", "a.txt"), "x");
    assert.equal(spawnSync("git", ["-C", root, "add", "packages"]).status, 0);
    return join(root, "packages", "app");
  };
  assert.equal(run({ writeFiles: [RUNTIME_SKILL] }, [], prepare).code, 0);
  const r = run({ writeFiles: ["../../skills/system/x/SKILL.md"] }, [], prepare);
  assert.equal(r.code, 4);
  assert.match(r.error, /skills\/system\/x\/SKILL\.md/);
});
test("a tracked skills/system file that changes still counts", () => {
  const prepare = (/** @type {string} */ root) => {
    gitRepoWithTracked(root);
    mkdirSync(join(root, "skills", "system"), { recursive: true });
    writeFileSync(join(root, "skills", "system", "kept.md"), "before");
    assert.equal(spawnSync("git", ["-C", root, "add", "skills"]).status, 0);
  };
  const r = run({ writeFiles: ["skills/system/kept.md"] }, [], prepare);
  assert.equal(r.code, 4);
  assert.match(r.error, /skills\/system\/kept\.md/);
});
test("a skills/system file that existed at launch and is gone at the end still counts", () => {
  const prepare = (/** @type {string} */ root) => {
    gitRepoWithTracked(root);
    mkdirSync(join(root, "skills", "system"), { recursive: true });
    writeFileSync(join(root, "skills", "system", "draft.md"), "untracked at launch");
  };
  const r = run({ removeFiles: ["skills/system/draft.md"] }, [], prepare);
  assert.equal(r.code, 4);
  assert.match(r.error, /skills\/system\/draft\.md/);
});
// No quote or arrow in the name: Windows rejects both in a file name.
test("paths with spaces and non-ASCII characters come through unquoted", () => {
  const r = run({ writeFiles: ["a space é.txt"] }, [], gitRepoWithTracked);
  assert.equal(r.code, 4);
  assert.match(r.error, /a space é\.txt/);
});
test("a checkout that is no longer a checkout at the end is a change", () => {
  // A clean checkout: an empty listing at launch must not be mistaken for an empty listing at the end.
  const r = run({ removeGit: true }, [], (root) => {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  });
  assert.equal(r.code, 4);
  assert.match(r.error, /git status failed/);
});
test("two renames that swap their sources are a change", () => {
  // An empty file, not the null device: git on Windows cannot read "\\.\nul" as a config file.
  const cfgDir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-gitcfg-"));
  const emptyConfig = join(cfgDir, "empty");
  writeFileSync(emptyConfig, "");
  const git = (/** @type {string} */ root, /** @type {string[]} */ ...args) => {
    const result = spawnSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "commit.gpgsign=false",
        "-c",
        `core.hooksPath=${cfgDir}`,
        ...args,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig },
      },
    );
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  };
  const prepare = (/** @type {string} */ root) => {
    git(root, "init", "-q", "--template=");
    writeFileSync(join(root, "old-a"), "content of a\n".repeat(20));
    writeFileSync(join(root, "old-b"), "content of b\n".repeat(20));
    git(root, "add", "-A");
    git(root, "commit", "-q", "--no-verify", "-m", "init");
    git(root, "mv", "old-a", "new-a");
    git(root, "mv", "old-b", "new-b");
  };
  try {
    const r = run(
      {
        // Rename detection switched off by configuration must not hide the swap.
        env: {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "status.renames",
          GIT_CONFIG_VALUE_0: "false",
        },
        git: [
          ["mv", "new-a", "tmp"],
          ["mv", "new-b", "new-a"],
          ["mv", "tmp", "new-b"],
        ],
      },
      [],
      prepare,
    );
    assert.equal(r.code, 4);
    assert.match(r.error, /new-a, new-b/);
  } finally {
    rmSync(cfgDir, { recursive: true, force: true });
  }
});
test("a git failure that is not 'not a git repository' is a failure to check, not a non-checkout", () => {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-badcfg-"));
  try {
    const bad = join(dir, "gitconfig");
    writeFileSync(bad, "[core\nthis is not a config file\n");
    const r = run({ env: { GIT_CONFIG_GLOBAL: bad } }, [], gitRepoWithTracked);
    assert.equal(r.code, 1);
    assert.match(r.error, /FATAL: git status failed at launch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a GIT_DIR that cannot be opened is a failure to check, not a non-checkout", () => {
  const r = run(
    { env: { GIT_DIR: join(tmpdir(), "acp-no-such-git-dir") } },
    [],
    gitRepoWithTracked,
  );
  assert.equal(r.code, 1);
  assert.match(r.error, /FATAL: git status failed at launch/);
});
test("an enclosing checkout found after the launch checkout is gone does not make a change look clean", () => {
  const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
    // The launch directory is a clean checkout inside an ignored directory of another clean checkout.
    assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
    writeFileSync(join(dir, ".gitignore"), "repo/\n");
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
  };
  const r = run({ removeGit: true, writeFiles: ["stray.txt"] }, [], prepare);
  assert.equal(r.code, 4);
  assert.match(r.error, /the git repository changed/);
});
test(
  "without a git program there is nothing to compare, as before",
  { skip: process.platform !== "linux" },
  () => {
    const empty = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-nogit-"));
    try {
      const r = run({ env: { PATH: empty }, writeFiles: ["stray.txt"] }, [], gitRepoWithTracked);
      assert.equal(r.code, 0);
      assert.doesNotMatch(r.error, /FATAL/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  },
);
// A newline in a file name is not allowed on Windows.
test(
  "a control character in a file name cannot forge a log line",
  { skip: process.platform !== "linux" },
  () => {
    const r = run({ writeFiles: ["a\nb.txt"] }, [], gitRepoWithTracked);
    assert.equal(r.code, 4);
    assert.match(r.error, /the seat wrote files: a\\x0ab\.txt\n/);
  },
);
// Linux only: other platforms reject a file name that is not valid UTF-8.
test(
  "file names that differ only in bytes that are not valid UTF-8 are different files",
  { skip: process.platform !== "linux" },
  () => {
    const prepare = (/** @type {string} */ root) => {
      gitRepoWithTracked(root);
      writeFileSync(
        Buffer.concat([Buffer.from(root + "/"), Buffer.from("\xff.txt", "latin1")]),
        "x",
      );
    };
    const r = run({ renameBytes: [["\xff.txt", "\xfe.txt"]] }, [], prepare);
    assert.equal(r.code, 4);
    // Both names are in the log, each byte written out; neither is a replacement character.
    assert.match(r.error, /\\xfe\.txt, \\xff\.txt|\\xff\.txt, \\xfe\.txt/);
  },
);
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
// The 1.2 s idle limit also covers starting the fake adapter, which took 0.6 s or more on the
// Windows runner. Chunks every 0.1 s for 1.8 s still outlast the limit, so only renewal passes.
test("streaming activity renews idle deadline", () => {
  const r = run({ chatty: true }, ["--idle-min", "0.02"]);
  assert.equal(r.code, 0);
  assert.match(r.text, /VERDICT:/);
});
test("a copy of the client and the file beside it runs without its source checkout", () => {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "acp-copy-"));
  try {
    const copy = join(dir, "client.mjs");
    writeFileSync(copy, readFileSync(client));
    writeFileSync(
      join(dir, "seat-launch.mjs"),
      readFileSync(join(dirname(client), "seat-launch.mjs")),
    );
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
    assert.equal(JSON.parse(r.text.split("\n")[0] ?? "").results[0].result.content, "inside");
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "EPERM") {
      t.skip("Native symlink creation unavailable");
    } else {
      throw e;
    }
  }
});

// ---- credential isolation, permission kinds, mode fallback, --no-web, policy hook ----
const POSIX_ONLY = { skip: process.platform === "win32" ? "needs POSIX executables" : false };
const SECRETS = {
  OPENAI_API_KEY: "o",
  ANTHROPIC_API_KEY: "a",
  GH_TOKEN: "g",
  SSH_AUTH_SOCK: "/agent.sock",
  GOOGLE_APPLICATION_CREDENTIALS: "/key.json",
  AWS_ACCESS_KEY_ID: "k",
  DEVIN_API_KEY: "d",
  CURSOR_API_KEY: "c",
  XAI_API_KEY: "x",
  BUN_AUTH_TOKEN: "b",
  XDG_SECRET: "s",
};
/** @param {{ launch: { env: string[] } | null }} r */
const seatEnvNames = (r) => new Set(r.launch?.env ?? []);
const CODEX_PACKAGE = "--package=@agentclientprotocol/codex-acp@2.5.0";
const CLAUDE_PACKAGE = "--package=@agentclientprotocol/claude-agent-acp@0.101.0";
// A package runner starting each agent: the runner is a shim named bunx that starts the fake. A Codex
// seat also needs `codex mcp list --json` to work, so it gets a shim that lists no servers.
const CODEX_LAUNCH = {
  launcher: "bunx",
  serverArgs: [CODEX_PACKAGE, "codex-acp"],
  codexShim: /** @type {unknown[]} */ ([]),
};
const CLAUDE_LAUNCH = { launcher: "bunx", serverArgs: [CLAUDE_PACKAGE, "claude-agent-acp"] };
test("a seat starts with named paths and locale, not the caller's keys, tokens or SSH agent", () => {
  const r = run({ env: SECRETS });
  assert.equal(r.code, 0);
  const env = seatEnvNames(r);
  for (const name of Object.keys(SECRETS)) {
    assert.equal(env.has(name), false, name);
  }
  assert.ok([...env].some((name) => name.toUpperCase() === "PATH"));
  assert.ok(env.has("FAKE_LOG"), "ACP_PANEL_PASS_ENV prefixes still pass");
});
test("a prefix named in ACP_PANEL_PASS_ENV passes and nothing else does", () => {
  const r = run({
    env: { ACP_PANEL_PASS_ENV: "FAKE_, EXTRA_,", EXTRA_KEEP: "1", OTHER_DROP: "1" },
  });
  const env = seatEnvNames(r);
  assert.ok(env.has("EXTRA_KEEP"));
  assert.equal(env.has("OTHER_DROP"), false);
});
for (const [name, config, keeps, drops] of /** @type {[string, any, string[], string[]][]} */ ([
  [
    "codex-acp by package",
    CODEX_LAUNCH,
    ["OPENAI_API_KEY"],
    ["ANTHROPIC_API_KEY", "DEVIN_API_KEY", "XAI_API_KEY", "CURSOR_API_KEY"],
  ],
  [
    "claude-agent-acp by package",
    CLAUDE_LAUNCH,
    ["ANTHROPIC_API_KEY"],
    ["OPENAI_API_KEY", "DEVIN_API_KEY"],
  ],
  [
    "an interpreter running a script under a cursor-agent directory",
    { fakeSegment: "cursor-agent" },
    ["CURSOR_API_KEY"],
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  ],
  [
    "an executable named devin",
    { devinShim: true },
    ["DEVIN_API_KEY"],
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  ],
  [
    "an ordinary argument that names other agents",
    { serverArgs: ["--cwd", "/repo/codex-claude-migration"] },
    [],
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  ],
  [
    "a script path segment that only contains an agent's name",
    { fakeSegment: "codex-claude-migration" },
    [],
    ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  ],
])) {
  test(
    `${name} keeps only its own login variables`,
    { skip: config.devinShim || config.launcher ? POSIX_ONLY.skip : false },
    () => {
      const r = run({ ...config, env: SECRETS });
      assert.equal(r.code, 0, r.error);
      const env = seatEnvNames(r);
      for (const key of keeps) {
        assert.ok(env.has(key), key);
      }
      for (const key of drops) {
        assert.equal(env.has(key), false, key);
      }
      for (const key of ["GH_TOKEN", "SSH_AUTH_SOCK", "BUN_AUTH_TOKEN", "XDG_SECRET"]) {
        assert.equal(env.has(key), false, key);
      }
    },
  );
}
for (const [value, kept] of [
  ["1", true],
  ["true", true],
  ["on", true],
  ["0", false],
  ["false", false],
  ["", false],
]) {
  test(
    `a Claude seat keeps AWS variables only when Bedrock is on (${JSON.stringify(value)})`,
    POSIX_ONLY,
    () => {
      const r = run({
        ...CLAUDE_LAUNCH,
        env: { ...SECRETS, CLAUDE_CODE_USE_BEDROCK: value },
      });
      assert.equal(seatEnvNames(r).has("AWS_ACCESS_KEY_ID"), kept);
    },
  );
}
test(
  "only a Claude seat on Bedrock keeps AWS variables, and Vertex keeps its credential path",
  POSIX_ONLY,
  () => {
    const bedrock = { ...SECRETS, CLAUDE_CODE_USE_BEDROCK: "1" };
    assert.equal(
      seatEnvNames(run({ ...CODEX_LAUNCH, env: bedrock })).has("AWS_ACCESS_KEY_ID"),
      false,
    );
    const vertex = run({
      ...CLAUDE_LAUNCH,
      env: {
        ...SECRETS,
        CLAUDE_CODE_USE_VERTEX: "1",
        CLOUD_ML_REGION: "us-east5",
        GOOGLE_OTHER: "x",
      },
    });
    const env = seatEnvNames(vertex);
    assert.ok(env.has("GOOGLE_APPLICATION_CREDENTIALS") && env.has("CLOUD_ML_REGION"));
    assert.equal(env.has("GOOGLE_OTHER"), false);
    assert.equal(
      seatEnvNames(run({ ...CLAUDE_LAUNCH, env: SECRETS })).has("GOOGLE_APPLICATION_CREDENTIALS"),
      false,
    );
  },
);
test("an unknown flag or a flag without its value is refused before any launch", () => {
  for (const flags of [
    ["--user-requested-effort"],
    ["--bogus"],
    ["--model"],
    ["--policy-option"],
    ["extra-positional"],
  ]) {
    const r = run({}, flags);
    assert.equal(r.code, 2, flags.join(" "));
    assert.match(r.error, /^usage:/m);
    assert.equal(r.launch, null);
  }
});
/** @param {string} body */
const policyModule = (body) => (/** @type {string} */ _root, /** @type {string} */ dir) => {
  writeFileSync(join(dir, "policy.mjs"), body);
};
test("a launch policy module sees model, effort, command and options and may refuse", () => {
  const prepare = policyModule(`
    export function check({ model, effort, command, options }) {
      if (model !== "chosen" || effort !== "high" || !Array.isArray(command) || command.length < 2) throw new Error("bad request");
      if (options["user-requested-effort"] !== "true" || options.limit !== "a=b") throw new Error("bad options");
    }
  `);
  const args = [
    "--policy",
    "%DIR%/policy.mjs",
    "--policy-option",
    "user-requested-effort",
    "--policy-option",
    "limit=a=b",
    "--model",
    "chosen",
    "--effort",
    "high",
  ];
  assert.equal(run({}, args, prepare).code, 0);
  const refused = run({}, args.slice(0, -1).concat("medium"), prepare);
  assert.equal(refused.code, 2);
  assert.match(refused.error, /FATAL: launch policy .*bad request/);
  assert.equal(refused.launch, null);
});
test("a policy refusal, a default export, an async check and a broken module", () => {
  const throwing = run(
    {},
    ["--policy", "%DIR%/policy.mjs"],
    policyModule("export const check = () => { throw new Error('too high'); };"),
  );
  assert.equal(throwing.code, 2);
  assert.match(throwing.error, /too high/);
  assert.equal(throwing.launch, null);
  assert.equal(
    run({}, ["--policy", "%DIR%/policy.mjs"], policyModule("export default async () => {};")).code,
    0,
  );
  const rejecting = run(
    {},
    ["--policy", "%DIR%/policy.mjs"],
    policyModule("export default async () => { throw new Error('late'); };"),
  );
  assert.equal(rejecting.code, 2);
  assert.equal(rejecting.launch, null);
  for (const body of ["export const other = 1;", "throw new Error('does not load');"]) {
    const broken = run({}, ["--policy", "%DIR%/policy.mjs"], policyModule(body));
    assert.equal(broken.code, 2);
    assert.equal(broken.launch, null);
  }
  const missing = run({}, ["--policy", "%DIR%/absent.mjs"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.launch, null);
});
test("Claude's adapter gets Read, Grep and Glob only, ignores the user's MCP servers and excludes settings sources", () => {
  /** @param {string[]} flags */
  const meta = (flags) =>
    run({}, flags).log.find((m) => m.method === "session/new").params._meta.claudeCode.options;
  const closed = {
    tools: ["Read", "Grep", "Glob"],
    disallowedTools: ["WebFetch", "WebSearch"],
    strictMcpConfig: true,
    settingSources: [],
  };
  assert.deepEqual(meta([]), closed);
  assert.deepEqual(meta(["--no-web"]), closed);
  assert.deepEqual(meta(["--allow-reads", "--no-web"]), closed);
  assert.deepEqual(meta(["--allow-reads"]), {
    tools: ["Read", "Grep", "Glob", "WebFetch", "WebSearch"],
    strictMcpConfig: true,
    settingSources: [],
  });
});
/** @param {string[]} kinds */
const permissionRequests = (kinds) =>
  kinds.map((kind) => ({
    method: "session/request_permission",
    params: {
      toolCall: kind === "none" ? {} : { kind },
      options: [
        { kind: "allow_once", optionId: "allow" },
        { kind: "reject_once", optionId: "reject" },
      ],
    },
  }));
/**
 * @param {string[]} flags
 * @param {string[]} kinds
 * @param {any} config
 */
const outcomes = (flags, kinds, config = {}) => {
  const r = run({ ...config, requests: permissionRequests(kinds) }, flags);
  assert.equal(r.code, 0, r.error);
  return JSON.parse(r.text.split("\n")[0] ?? "").results.map(
    (/** @type {any} */ row) => row.result.outcome.optionId,
  );
};
const KINDS = [
  "read",
  "search",
  "think",
  "fetch",
  "execute",
  "edit",
  "delete",
  "move",
  "other",
  "none",
];
test("--allow-reads allows only read, search, think and fetch requests", () => {
  assert.deepEqual(outcomes(["--allow-reads"], KINDS), [
    "allow",
    "allow",
    "allow",
    "allow",
    "reject",
    "reject",
    "reject",
    "reject",
    "reject",
    "reject",
  ]);
});
test("--allow-reads with --no-web refuses fetch too, and Codex is always refused", () => {
  // Under --no-web a search is refused too: an agent can call a web search a search.
  assert.deepEqual(outcomes(["--allow-reads", "--no-web"], ["search", "think"]), [
    "reject",
    "allow",
  ]);
  assert.equal(outcomes(["--allow-reads", "--no-web"], ["fetch", "read"])[0], "reject");
  assert.deepEqual(outcomes(["--allow-reads", "--no-web"], ["fetch", "read"]).slice(1), ["allow"]);
  assert.deepEqual(outcomes(["--allow-reads"], ["read", "search"], { codex: true }), [
    "reject",
    "reject",
  ]);
  assert.deepEqual(outcomes([], ["read", "fetch"]), ["reject", "reject"]);
});
for (const start of ["auto", "acceptEdits", "bypassPermissions"]) {
  test(`an agent without read-only that starts in ${start} is set to default and must echo it`, () => {
    const r = run({ modes: ["default", "plan"], modeStart: start });
    assert.equal(r.code, 0, r.error);
    assert.deepEqual(
      r.log.filter((m) => m.method === "session/set_config_option").map((m) => m.params),
      [{ sessionId: "s", configId: "mode", value: "default" }],
    );
    assert.match(r.error, /mode -> default/);
    const refused = run({ modes: ["default"], modeStart: start, echo: "wrong" });
    assert.equal(refused.code, 1);
    assert.equal(
      refused.log.some((m) => m.method === "session/prompt"),
      false,
    );
  });
}
test("a mode that cannot approve an edit is kept, and read-only wins when offered", () => {
  for (const config of [
    { modes: ["default", "plan"], modeStart: "default" },
    { modes: ["plan", "ask"], modeStart: "plan" },
  ]) {
    const r = run(config);
    assert.equal(r.code, 0, r.error);
    assert.equal(
      r.log.some((m) => m.method === "session/set_config_option"),
      false,
      JSON.stringify(config),
    );
  }
  const readOnly = run({ modes: ["default", "read-only"], modeStart: "auto" });
  assert.deepEqual(
    readOnly.log.filter((m) => m.method === "session/set_config_option").map((m) => m.params.value),
    ["read-only"],
  );
});
test("an agent in an edit-approving mode with no read-only, default or ask mode to move to is refused", () => {
  for (const modeStart of ["auto", "acceptEdits", "bypassPermissions", "accept-edits", "bypass"]) {
    const r = run({ modes: ["plan", "smart"], modeStart });
    assert.equal(r.code, 1, modeStart);
    assert.match(r.error, /can approve an edit without asking/);
    assert.equal(
      r.log.some((m) => m.method === "session/prompt"),
      false,
    );
  }
});
test("Codex must still confirm read-only even when default is offered", () => {
  const r = run({ codex: true, modes: ["default"], modeStart: "auto" });
  assert.equal(r.code, 1);
  assert.equal(
    r.log.some((m) => m.method === "session/prompt"),
    false,
  );
});
test("a model echo may differ in case or provider prefix, never in the model", () => {
  assert.equal(run({}, ["--model", "chosen"]).code, 0);
  assert.equal(run({ echoModel: "Vendor/CHOSEN" }, ["--model", "chosen"]).code, 0);
  assert.equal(run({}, ["--model", "vendor/Chosen"]).code, 0);
  const other = run({ echoModel: "other-model" }, ["--model", "chosen"]);
  assert.equal(other.code, 1);
  assert.equal(
    other.log.some((m) => m.method === "session/prompt"),
    false,
  );
});
test("a server that exits before answering ends the run at once", () => {
  const r = run({ dieOnNew: true });
  assert.equal(r.code, 1);
  assert.match(r.error, /FATAL: ACP server exited/);
});
test("a server command that cannot start ends the run at once", () => {
  const r = run({ serverNotFound: true });
  assert.equal(r.code, 1);
  assert.match(r.error, /FATAL: /);
});
/**
 * @param {string | undefined} kind
 * @param {string} [status]
 * @param {Record<string, unknown>} [extra]
 */
const toolUpdate = (kind, status = "completed", extra = {}) => ({
  sessionUpdate: "tool_call",
  toolCallId: "t1",
  kind,
  status,
  title: "tool",
  ...extra,
});
for (const [name, config, flags, code] of /** @type {[string, any, string[], number][]} */ ([
  ["a completed fetch", { toolUpdates: [toolUpdate("fetch")] }, ["--no-web"], 5],
  ["a completed fetch without --no-web", { toolUpdates: [toolUpdate("fetch")] }, [], 0],
  ["a completed MCP tool", { toolUpdates: [toolUpdate("other")] }, ["--no-web"], 5],
  ["a completed call with no kind", { toolUpdates: [toolUpdate(undefined)] }, ["--no-web"], 5],
  ["a completed read", { toolUpdates: [toolUpdate("read")] }, ["--no-web"], 0],
  ["a failed fetch", { toolUpdates: [toolUpdate("fetch", "failed")] }, ["--no-web"], 0],
  ["a pending fetch", { toolUpdates: [toolUpdate("fetch", "in_progress")] }, ["--no-web"], 0],
  ["a Claude Grep or Glob", { toolUpdates: [toolUpdate("search")] }, ["--no-web"], 0],
  ["a Claude shell", { toolUpdates: [toolUpdate("execute")] }, ["--no-web"], 5],
  [
    "a fetch the client refused",
    {
      requests: permissionRequests(["fetch"]).map((q) => ({
        ...q,
        params: { ...q.params, toolCall: { kind: "fetch", toolCallId: "t1" } },
      })),
      toolUpdates: [toolUpdate("fetch")],
    },
    ["--no-web"],
    0,
  ],
  [
    "Devin's skill tool",
    {
      toolUpdates: [
        toolUpdate(undefined, "completed", {
          _meta: { "cognition.ai/inferenceToolName": "skill" },
        }),
      ],
    },
    ["--no-web"],
    0,
  ],
  ["a Codex shell", { codex: true, toolUpdates: [toolUpdate("execute")] }, ["--no-web"], 0],
  [
    "a Codex file search through the shell",
    { codex: true, toolUpdates: [toolUpdate("search", "completed", { toolCallId: "exec-1" })] },
    ["--no-web"],
    0,
  ],
  [
    "a Codex web search",
    {
      codex: true,
      toolUpdates: [toolUpdate("search", "completed", { rawInput: { type: "webSearch" } })],
    },
    ["--no-web"],
    5,
  ],
  [
    "a Codex web search under an exec- id",
    {
      codex: true,
      toolUpdates: [
        toolUpdate("search", "completed", {
          toolCallId: "exec-2",
          rawInput: { type: "webSearch" },
        }),
      ],
    },
    ["--no-web"],
    5,
  ],
])) {
  test(`--no-web exit status for ${name} is ${code}`, () => {
    const r = run(config, flags);
    assert.equal(r.code, code, r.error);
    if (code === 5) {
      assert.match(r.error, /tool call ran despite --no-web/);
    }
  });
}
test("a workspace change outranks a network call in the exit status", () => {
  const r = run({ mutate: true, toolUpdates: [toolUpdate("fetch")] }, ["--no-web"], (root) => {
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    writeFileSync(join(root, "tracked.txt"), "original");
    assert.equal(spawnSync("git", ["-C", root, "add", "-A"]).status, 0);
  });
  assert.equal(r.code, 4);
});
test(
  "every Codex seat starts through a private wrapper with its MCP servers off, and --no-web adds web search and apps",
  POSIX_ONLY,
  () => {
    const config = {
      codex: true,
      launcher: "bunx",
      serverArgs: [CODEX_PACKAGE, "codex-acp"],
      codexShim: [{ name: "alpha" }, { name: "beta-2" }],
    };
    for (const flags of [[], ["--no-web"]]) {
      const r = run(config, flags);
      assert.equal(r.code, 0, r.error);
      const launch = r.launch;
      assert.ok(launch?.codexPath?.endsWith("codex-no-web"));
      assert.match(launch.wrapper, /mcp_servers\.alpha\.enabled=false/);
      assert.match(launch.wrapper, /mcp_servers\.beta-2\.enabled=false/);
      assert.equal(/web_search="disabled"/.test(launch.wrapper), flags.length > 0);
      assert.equal(/features\.apps=false/.test(launch.wrapper), flags.length > 0);
      assert.match(launch.realCodex ?? "", /codex$/);
      assert.equal(existsSync(launch.codexPath), false, "the private directory is removed at exit");
    }
  },
);
test(
  "a Codex seat is refused when its MCP servers cannot be listed or turned off",
  POSIX_ONLY,
  () => {
    for (const codexShim of ["fail", [{ name: "bad name" }]]) {
      for (const flags of [[], ["--no-web"]]) {
        const r = run({ ...CODEX_LAUNCH, codex: true, codexShim }, flags);
        assert.equal(r.code, 2);
        assert.match(r.error, /cannot turn off Codex's MCP servers/);
        assert.equal(r.launch, null);
      }
    }
  },
);
const DEVIN_ALWAYS = [
  "exec",
  "mcp__*",
  "mcp_call_tool",
  "mcp_read_resource",
  "mcp_list_tools",
  "mcp_list_resources",
];
const DEVIN_OFFLINE = ["Fetch(*)", "web_search", "webfetch", "run_subagent"];
test(
  "Devin starts with a private config that denies its shell and every MCP operation",
  POSIX_ONLY,
  () => {
    const r = run({ devinShim: true, serverArgs: ["acp"] });
    assert.equal(r.code, 0, r.error);
    const devin = r.launch?.devin;
    assert.deepEqual(r.launch?.argv, ["--config", devin.file, "acp"]);
    for (const rule of DEVIN_ALWAYS) {
      assert.ok(devin.config.permissions.deny.includes(rule), rule);
    }
    for (const rule of DEVIN_OFFLINE) {
      assert.equal(devin.config.permissions.deny.includes(rule), false, rule);
    }
    assert.equal(devin.fileMode, 0o600);
    assert.equal(devin.dirMode, 0o700);
    assert.equal(existsSync(devin.file), false, "the copy is removed at exit");
    const offline = run({ devinShim: true }, ["--no-web"]).launch?.devin;
    for (const rule of [...DEVIN_ALWAYS, ...DEVIN_OFFLINE]) {
      assert.ok(offline.config.permissions.deny.includes(rule), rule);
    }
  },
);
test("Devin's own config is the base: its hooks and deny rules survive", POSIX_ONLY, () => {
  const prepare = (/** @type {string} */ _root, /** @type {string} */ dir) => {
    mkdirSync(join(dir, "xdg", "devin"), { recursive: true });
    writeFileSync(
      join(dir, "xdg", "devin", "config.json"),
      JSON.stringify({
        version: 1,
        hooks: { pre: "audit" },
        permissions: { deny: ["Read(~/.ssh/*)"], allow: ["Read(*)"] },
      }),
    );
  };
  const r = run({ devinShim: true, env: { XDG_CONFIG_HOME: "%DIR%/xdg" } }, [], prepare);
  assert.equal(r.code, 0, r.error);
  const config = r.launch?.devin.config;
  assert.deepEqual(config.hooks, { pre: "audit" });
  assert.deepEqual(config.permissions.allow, ["Read(*)"]);
  assert.ok(config.permissions.deny.includes("Read(~/.ssh/*)"));
  assert.ok(config.permissions.deny.includes("exec"));
});
test(
  "a launch that names its own Devin config uses it once, in either form, relative to the seat's directory",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ root) => {
      writeFileSync(join(root, "own.json"), JSON.stringify({ version: 1, hooks: { own: true } }));
    };
    for (const serverArgs of [
      ["--config", "own.json", "acp"],
      ["--config=own.json", "acp"],
    ]) {
      const r = run({ devinShim: true, serverArgs }, [], prepare);
      assert.equal(r.code, 0, r.error);
      const argv = r.launch?.argv ?? [];
      assert.equal(
        argv.filter((/** @type {string} */ a) => a === "--config" || a.startsWith("--config="))
          .length,
        1,
      );
      assert.deepEqual(argv.slice(2), ["acp"]);
      assert.deepEqual(r.launch?.devin.config.hooks, { own: true });
      assert.ok(r.launch?.devin.config.permissions.deny.includes("exec"));
    }
  },
);
test("a Devin config that cannot be read refuses the launch", POSIX_ONLY, () => {
  const r = run({ devinShim: true, serverArgs: ["--config", "absent.json", "acp"] });
  assert.equal(r.code, 2);
  assert.match(r.error, /cannot read Devin config/);
  assert.equal(r.launch, null);
});
test("another agent's command is not given a Devin config", () => {
  assert.equal(run({}).launch?.argv.includes("--config"), false);
});

test(
  "agent detection does not take a flag's value or a stray --package= for the script",
  POSIX_ONLY,
  () => {
    for (const serverArgs of [
      ["--cwd", "/tools/claude", "%FAKE%"],
      ["--package=@agentclientprotocol/claude-agent-acp@0.101.0", "%FAKE%"],
      ["--cwd=/tools/codex", "%FAKE%"],
    ]) {
      const r = run({ launcher: "bun", serverArgs, env: SECRETS });
      assert.equal(r.code, 0, r.error);
      const env = seatEnvNames(r);
      for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "SSH_AUTH_SOCK"]) {
        assert.equal(env.has(key), false, `${serverArgs.join(" ")}: ${key}`);
      }
    }
  },
);
test("a flag's missing value cannot swallow the next flag", () => {
  for (const flags of [
    ["--policy-option", "--no-web"],
    ["--verdict", "--no-web"],
    ["--effort", "--no-web"],
    ["--model", "--allow-reads"],
  ]) {
    const r = run({}, flags);
    assert.equal(r.code, 2, flags.join(" "));
    assert.equal(r.launch, null);
  }
});
test(
  "git runs without the caller's secrets, and a filesystem monitor in the repository does not run",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      const git = (/** @type {string[]} */ ...args) =>
        assert.equal(
          spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).status,
          0,
          args.join(" "),
        );
      git("init", "-q", "--template=");
      writeFileSync(join(root, ".gitattributes"), "* filter=probe\n");
      writeFileSync(join(root, "tracked.txt"), "one");
      git("add", "-A");
      git(
        "-c",
        "user.email=a@b",
        "-c",
        "user.name=n",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "--no-verify",
        "-m",
        "init",
      );
      // A clean filter runs when git compares a modified file; a filesystem monitor on every status.
      git("config", "filter.probe.clean", `env > "${dir}/filter-env"; cat`);
      writeFileSync(join(dir, "monitor.sh"), `#!/bin/sh\ntouch "${dir}/monitor-ran"\n`, {
        mode: 0o755,
      });
      git("config", "core.fsmonitor", join(dir, "monitor.sh"));
      writeFileSync(join(root, "tracked.txt"), "two, changed after the commit");
    };
    const r = run({ env: SECRETS, readBack: ["filter-env", "monitor-ran"] }, [], prepare);
    assert.equal(r.code, 0, r.error);
    assert.equal(r.read["monitor-ran"], null, "core.fsmonitor is switched off on the command line");
    const filterEnv = r.read["filter-env"] ?? "";
    assert.match(filterEnv, /^PATH=/m, "the filter did run, so the check below means something");
    for (const name of ["GH_TOKEN", "SSH_AUTH_SOCK", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
      assert.doesNotMatch(filterEnv, new RegExp(`^${name}=`, "m"));
    }
  },
);
test("a seat's stderr lines are marked, and control characters in seat text cannot forge a client line", () => {
  const forged = "[client] FATAL: usage limit reached";
  const r = run({ stderrLine: forged }, []);
  assert.equal(r.code, 0, r.error);
  assert.match(
    r.error,
    new RegExp(`^\\[seat\\] ${forged.replaceAll("[", "\\[").replaceAll("]", "\\]")}$`, "m"),
  );
  assert.doesNotMatch(r.error, /^\[client\] FATAL: usage limit/m);
  const titled = run(
    {
      toolUpdates: [
        {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          kind: "read",
          status: "completed",
          title: `x\n${forged}\u001b[2J`,
        },
      ],
    },
    ["--no-web"],
  );
  assert.equal(titled.code, 0, titled.error);
  assert.doesNotMatch(titled.error, /^\[client\] FATAL: usage limit/m);
  assert.match(titled.error, /x\\x0a\[client\] FATAL: usage limit reached\\x1b\[2J/);
});
test("an answer file a seat replaces with a symlink is not written through", POSIX_ONLY, () => {
  const r = run({ outInRoot: true, symlinkAnswer: true });
  assert.equal(r.code, 1);
  assert.match(r.error, /FATAL: /);
  assert.equal(r.outside, "keep");
});
test(
  "an answer file the caller named through a symlink is written where it points",
  POSIX_ONLY,
  () => {
    const r = run({ outInRoot: true }, [], (root, dir) => {
      writeFileSync(join(dir, "target.txt"), "old");
      symlinkSync(join(dir, "target.txt"), join(root, "answer.txt"));
    });
    assert.equal(r.code, 0, r.error);
    assert.match(r.text, /VERDICT/);
  },
);
test(
  "a seat cannot make the client hold an endless message, answer or tool list",
  { timeout: 60000 },
  () => {
    const line = run({ bigLine: 17 * 1024 * 1024 });
    assert.equal(line.code, 1);
    assert.match(line.error, /server message is longer than/);
    const answer = run({ bigChunks: 34 });
    assert.equal(answer.code, 1);
    assert.match(answer.error, /the answer is longer than/);
    const tools = run({ manyTools: 100001 });
    assert.equal(tools.code, 1);
    assert.match(tools.error, /more than 100000 tool calls/);
  },
);

test(
  "a stopped client ends the server, exits 128 + the signal and removes its private files",
  POSIX_ONLY,
  () => {
    const r = run({ devinShim: true, silent: true, killAfter: 4000 });
    assert.equal(r.code, 143);
    const file = r.launch?.devin?.file;
    assert.ok(file, "the seat started with a Devin config");
    assert.equal(existsSync(file), false);
  },
);
test("a seat directory with project Devin settings is refused", POSIX_ONLY, () => {
  for (const name of ["config.json", "config.local.json"]) {
    const r = run({ devinShim: true }, [], (root) => {
      mkdirSync(join(root, ".devin"));
      writeFileSync(join(root, ".devin", name), "{}");
    });
    assert.equal(r.code, 2, name);
    assert.match(r.error, /can hold Devin settings, MCP servers or hooks/);
    assert.equal(r.launch, null);
  }
});
test(
  "in every mode Devin stops importing other tools' settings, and listed sources stay off",
  POSIX_ONLY,
  () => {
    const all = [
      "claude",
      "cursor",
      "opencode",
      "windsurf",
      "zed",
      "vscode",
      "copilot",
      "agents_standard",
      "cloud",
    ];
    const prepare = (/** @type {string} */ _root, /** @type {string} */ dir) => {
      mkdirSync(join(dir, "xdg", "devin"), { recursive: true });
      writeFileSync(
        join(dir, "xdg", "devin", "config.json"),
        JSON.stringify({ version: 1, read_config_from: { claude: true, custom_tool: true } }),
      );
    };
    for (const flags of [[], ["--no-web"]]) {
      const config = run({ devinShim: true, env: { XDG_CONFIG_HOME: "%DIR%/xdg" } }, flags, prepare)
        .launch?.devin.config;
      assert.deepEqual(Object.keys(config.read_config_from).sort(), [...all, "custom_tool"].sort());
      assert.ok(Object.values(config.read_config_from).every((v) => v === false));
    }
  },
);

test(
  "Codex's MCP servers are listed from the review root, so its own project servers are turned off",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ root) => {
      writeFileSync(join(root, "project-mcp"), "");
    };
    const r = run({ ...CODEX_LAUNCH, codex: true, codexShim: "from-cwd" }, [], prepare);
    assert.equal(r.code, 0, r.error);
    assert.match(r.launch?.wrapper ?? "", /mcp_servers\.project\.enabled=false/);
  },
);
test(
  "project Devin settings in any ancestor of the review root refuse the launch",
  POSIX_ONLY,
  () => {
    const r = run({ devinShim: true }, [], (root) => {
      mkdirSync(join(root, ".devin"));
      writeFileSync(join(root, ".devin", "config.local.json"), "{}");
      mkdirSync(join(root, "sub"));
      return join(root, "sub");
    });
    assert.equal(r.code, 2);
    assert.match(r.error, /can hold Devin settings, MCP servers or hooks/);
    assert.equal(r.launch, null);
  },
);
test(
  "an answer that passes its limit after the last reply still fails the run",
  { timeout: 60000 },
  () => {
    const r = run({ lateOverflow: true });
    assert.equal(r.code, 1, r.error);
    assert.match(r.error, /the answer is longer than/);
  },
);
test(
  "a stopped client kills a server that ignores SIGTERM",
  { ...POSIX_ONLY, timeout: 30000 },
  () => {
    const r = run({ devinShim: true, silent: true, ignoreTerm: true, killAfter: 3000 });
    assert.equal(r.code, 143);
    const pid = r.launch?.pid;
    assert.ok(pid);
    // Give the system a moment to reap it; a zombie is not running.
    const running = () => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      try {
        return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
      } catch {
        return true;
      }
    };
    for (let i = 0; i < 30 && running(); i++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    assert.equal(running(), false, "the server is gone");
  },
);
test(
  "a server that exits while a helper still holds its pipes ends the run within seconds",
  POSIX_ONLY,
  () => {
    const started = Date.now();
    const r = run({ helperExit: true });
    assert.equal(r.code, 1, r.error);
    assert.match(r.error, /ACP server exited/);
    assert.ok(Date.now() - started < 10000);
  },
);

test(
  "a stop keeps its exit code when the server's exit fallback also fires",
  { ...POSIX_ONLY, timeout: 30000 },
  () => {
    // The server answers nothing and a helper holds its pipes; the stop kills the server, whose exit the
    // fallback sees a second later while the client still waits for the pipes to close.
    const r = run({ devinShim: true, silent: true, helperHolds: true, killAfter: 3000 });
    assert.equal(r.code, 143);
  },
);

test("CODEX_CONFIG keeps the caller's settings but loses its MCP server table", POSIX_ONLY, () => {
  const configured = JSON.stringify({ model: "m", mcp_servers: { injected: { command: "x" } } });
  const r = run({ ...CODEX_LAUNCH, env: { CODEX_CONFIG: configured } });
  assert.equal(r.code, 0, r.error);
  assert.deepEqual(JSON.parse(r.launch?.codexConfig ?? "null"), { model: "m" });
  const broken = run({ ...CODEX_LAUNCH, env: { CODEX_CONFIG: "{not json" } });
  assert.equal(broken.code, 2);
  assert.match(broken.error, /CODEX_CONFIG is not valid JSON/);
  assert.equal(broken.launch, null);
  assert.equal(run({ ...CODEX_LAUNCH }).launch?.codexConfig, null);
});
test("output after the answer is written is not read and does not change the outcome", () => {
  const r = run({ afterReply: true, linger: false });
  assert.equal(r.code, 0, r.error);
  assert.match(r.text, /VERDICT/);
  assert.ok(r.text.length < 10000);
});
test(
  "a stop during the final seconds keeps exit 128 + the signal, and the server is killed",
  { ...POSIX_ONLY, timeout: 30000 },
  () => {
    const r = run({ devinShim: true, ignoreTerm: true, linger: true, killAfter: 1500 });
    assert.equal(r.code, 143);
  },
);
test("a tool id the seat makes very long is logged short and still tracked", () => {
  const id = "t".repeat(5000);
  const done = {
    sessionUpdate: "tool_call",
    toolCallId: id,
    kind: "fetch",
    status: "completed",
    title: "x",
  };
  const refusedRequest = {
    method: "session/request_permission",
    params: {
      toolCall: { kind: "fetch", toolCallId: id },
      options: [{ kind: "reject_once", optionId: "reject" }],
    },
  };
  const ran = run({ toolUpdates: [done] }, ["--no-web"]);
  assert.equal(ran.code, 5);
  assert.ok(ran.error.split("\n").every((line) => line.length < 400));
  const refused = run({ requests: [refusedRequest], toolUpdates: [done] }, ["--no-web"]);
  assert.equal(refused.code, 0, refused.error);
});

test(
  "the project scan stops at the repository root, so a folder above it is not read",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      mkdirSync(join(dir, ".devin"));
      mkdirSync(join(root, ".git"));
    };
    assert.equal(run({ devinShim: true }, [], prepare).code, 0);
    const noRoot = run({ devinShim: true }, [], (_root, dir) => mkdirSync(join(dir, ".devin")));
    assert.equal(noRoot.code, 2, "without a .git or .jj the scan goes up the path");
  },
);
test("an offline Devin seat is refused while a Devin MCP server is enabled", POSIX_ONLY, () => {
  /** @param {unknown} servers @param {string} [where] */
  const withServers =
    (servers, where = "mcp_config.json") =>
    (/** @type {string} */ _r, /** @type {string} */ dir) => {
      mkdirSync(join(dir, "xdg", "devin"), { recursive: true });
      writeFileSync(
        join(dir, "xdg", "devin", where),
        JSON.stringify(where === "config.json" ? { mcpServers: servers } : { mcpServers: servers }),
      );
    };
  const env = { XDG_CONFIG_HOME: "%DIR%/xdg" };
  const enabled = { search: { command: "x" } };
  for (const where of ["mcp_config.json", "config.json"]) {
    const refused = run({ devinShim: true, env }, ["--no-web"], withServers(enabled, where));
    assert.equal(refused.code, 2, where);
    assert.match(refused.error, /Devin MCP servers search connect at startup/);
    assert.equal(refused.launch, null);
    assert.equal(
      run({ devinShim: true, env }, [], withServers(enabled, where)).code,
      0,
      "online is allowed",
    );
  }
  assert.equal(
    run(
      { devinShim: true, env },
      ["--no-web"],
      withServers({ off: { command: "x", disabled: true } }),
    ).code,
    0,
  );
  assert.equal(
    run(
      { devinShim: true, env },
      ["--no-web"],
      withServers({ off: { command: "x", enabled: false } }),
    ).code,
    0,
  );
});
test(
  "a Devin launch that names --config twice is refused, and --config goes after a runner's devin",
  POSIX_ONLY,
  () => {
    const twice = run({
      devinShim: true,
      serverArgs: ["--config", "a.json", "--config=b.json", "acp"],
    });
    assert.equal(twice.code, 2);
    assert.match(twice.error, /names --config more than once/);
    const r = run({ launcher: "bunx", serverArgs: ["devin", "acp"], env: { DEVIN_API_KEY: "d" } });
    assert.equal(r.code, 0, r.error);
    assert.equal(r.launch?.argv[0], "devin");
    assert.equal(r.launch?.argv[1], "--config");
    assert.equal(r.launch?.argv[3], "acp");
  },
);

test(
  "a stop keeps its exit status when the server answers the pending request with an error first",
  { ...POSIX_ONLY, timeout: 30000 },
  () => {
    const r = run({ devinShim: true, silent: true, errorOnTerm: true, killAfter: 2500 });
    assert.equal(r.code, 143);
  },
);
test(
  "an offline Devin seat is refused when an MCP config exists but cannot be read here",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ _r, /** @type {string} */ dir) => {
      mkdirSync(join(dir, "xdg", "devin"), { recursive: true });
      writeFileSync(join(dir, "xdg", "devin", "mcp_config.json"), "{not json at all");
    };
    const env = { XDG_CONFIG_HOME: "%DIR%/xdg" };
    const refused = run({ devinShim: true, env }, ["--no-web"], prepare);
    assert.equal(refused.code, 2);
    assert.match(
      refused.error,
      /cannot read .*mcp_config\.json to check that no Devin MCP server is enabled/,
    );
    assert.equal(refused.launch, null);
    assert.equal(
      run({ devinShim: true, env }, [], prepare).code,
      0,
      "online, nothing depends on it",
    );
  },
);

test("a seat's object-valued tool id and kind are handled as short text", () => {
  const r = run({ objectIdFlood: 30 }, ["--no-web"]);
  assert.equal(r.code, 0, r.error);
  assert.ok(r.error.split("\n").every((line) => line.length < 300));
});

test("a flood of empty lines from the seat is read without trouble", () => {
  const r = run({ newlineFlood: true });
  assert.equal(r.code, 0, r.error);
  assert.match(r.text, /VERDICT/);
});
test(
  "a Devin config that is not an object, or whose deny list is not a list, refuses the launch",
  POSIX_ONLY,
  () => {
    for (const body of ["null", "[]", '"text"', '{"permissions":{"deny":"exec"}}']) {
      const r = run(
        { devinShim: true, serverArgs: ["--config", "own.json", "acp"] },
        [],
        (root) => {
          writeFileSync(join(root, "own.json"), body);
        },
      );
      assert.equal(r.code, 2, body);
      assert.match(r.error, /is not a JSON object|permissions\.deny is not a list/);
      assert.equal(r.launch, null);
    }
  },
);

test("a call typed as a web search is network use for any agent, kind search or not", () => {
  const search = {
    sessionUpdate: "tool_call",
    toolCallId: "w1",
    kind: "search",
    status: "completed",
    title: "web",
    rawInput: { type: "webSearch" },
  };
  assert.equal(run({ toolUpdates: [search] }, ["--no-web"]).code, 5);
  assert.equal(run({ toolUpdates: [{ ...search, rawInput: undefined }] }, ["--no-web"]).code, 0);
  const asked = run(
    {
      requests: [
        {
          method: "session/request_permission",
          params: {
            toolCall: { kind: "search", toolCallId: "w2", rawInput: { type: "webSearch" } },
            options: [
              { kind: "allow_once", optionId: "allow" },
              { kind: "reject_once", optionId: "reject" },
            ],
          },
        },
      ],
    },
    ["--allow-reads", "--no-web"],
  );
  assert.equal(asked.code, 0, asked.error);
  assert.equal(
    JSON.parse(asked.text.split("\n")[0] ?? "").results[0].result.outcome.optionId,
    "reject",
  );
});
test("a model echo may add or drop a provider prefix but not change it", () => {
  assert.equal(run({}, ["--model", "vendor-a/chosen"]).code, 0);
  assert.equal(run({ echoModel: "vendor-a/Chosen" }, ["--model", "vendor-a/chosen"]).code, 0);
  assert.equal(run({ echoModel: "vendor-a/chosen" }, ["--model", "chosen"]).code, 0);
  const swapped = run({ echoModel: "vendor-b/chosen" }, ["--model", "vendor-a/chosen"]);
  assert.equal(swapped.code, 1);
  assert.equal(
    swapped.log.some((m) => m.method === "session/prompt"),
    false,
  );
});
test(
  "only a codex-acp package name makes a launch a Codex launch, not any argument containing it",
  POSIX_ONLY,
  () => {
    // A script in a directory named codex-acp-tools is no Codex: no wrapper, so no `codex` is needed.
    const plain = run({
      fakeSegment: "codex-acp-tools",
      serverArgs: ["--cwd", "/x/codex-acp-tools"],
    });
    assert.equal(plain.code, 0, plain.error);
    assert.equal(plain.launch?.wrapper, undefined);
    // A runner launch the client cannot read still names the package, so it gets the wrapper.
    const ambiguous = run({
      launcher: "npx",
      codexShim: [],
      // The launch is ambiguous, so the Codex login variables are not passed; CODEX_PATH is, by name.
      env: { ACP_PANEL_PASS_ENV: "FAKE_,CODEX_PATH" },
      serverArgs: ["--cache", "/x", "@agentclientprotocol/codex-acp@2.5.0"],
    });
    assert.equal(ambiguous.code, 0, ambiguous.error);
    assert.ok(ambiguous.launch?.codexPath?.endsWith("codex-no-web"));
  },
);
test("a Devin launch the client cannot read is refused before it starts", POSIX_ONLY, () => {
  const r = run({ launcher: "npx", serverArgs: ["--cache", "/x", "devin", "acp"] });
  assert.equal(r.code, 2);
  assert.match(r.error, /may start Devin/);
  assert.equal(r.launch, null);
});

test("the advertised spelling of a model is what the agent is sent", () => {
  const r = run({}, ["--model", "vendor/Chosen"]);
  assert.equal(r.code, 0, r.error);
  const set = r.log.find(
    (m) => m.method === "session/set_config_option" && m.params.configId === "model",
  );
  assert.equal(set.params.value, "chosen");
});
test(
  "a Codex launch beside a preload is wrapped, a Grok launch that merely mentions codex-acp is not",
  POSIX_ONLY,
  () => {
    const wrapped = run({
      launcher: "node",
      codexShim: [],
      env: { ACP_PANEL_PASS_ENV: "FAKE_,CODEX_PATH" },
      serverArgs: ["--import", "shared/preload.mjs", "codex-acp/index.js"],
    });
    assert.equal(wrapped.code, 0, wrapped.error);
    assert.ok(wrapped.launch?.codexPath?.endsWith("codex-no-web"));
    const plain = run({
      launcher: "node",
      serverArgs: ["--title", "codex-acp", "grok/server.mjs"],
    });
    assert.equal(plain.code, 0, plain.error);
    assert.equal(plain.launch?.wrapper, undefined);
  },
);
test("a web search request is refused when the tracking set is full, from the request itself", () => {
  const asked = (/** @type {string} */ id) => ({
    method: "session/request_permission",
    params: {
      toolCall: { kind: "search", toolCallId: id, rawInput: { type: "webSearch" } },
      options: [
        { kind: "allow_once", optionId: "allow" },
        { kind: "reject_once", optionId: "reject" },
      ],
    },
  });
  // The typed input alone is enough, with no earlier request or update for the id.
  const r = run({ requests: [asked("only-one")] }, ["--allow-reads", "--no-web"]);
  assert.equal(
    JSON.parse(r.text.split("\n")[0] ?? "").results[0].result.outcome.optionId,
    "reject",
  );
});

test("Devin's edit-approving modes are moved to ask, and its other modes are kept", () => {
  const devinModes = ["accept-edits", "smart", "ask", "plan", "bypass"];
  for (const modeStart of ["accept-edits", "smart", "bypass"]) {
    const r = run({ modes: devinModes, modeStart });
    assert.equal(r.code, 0, r.error);
    assert.deepEqual(
      r.log.filter((m) => m.method === "session/set_config_option").map((m) => m.params.value),
      ["ask"],
      modeStart,
    );
  }
  for (const modeStart of ["ask", "plan"]) {
    const r = run({ modes: devinModes, modeStart });
    assert.equal(r.code, 0, r.error);
    assert.equal(
      r.log.some((m) => m.method === "session/set_config_option"),
      false,
      modeStart,
    );
  }
});
test(
  "an answer path a seat made a hard link to another file is replaced, not truncated",
  POSIX_ONLY,
  () => {
    const r = run({ outInRoot: true, hardlinkAnswer: true });
    assert.equal(r.code, 0, r.error);
    assert.match(r.text, /VERDICT/);
    assert.equal(r.outside, "keep");
  },
);

test("an existing answer file keeps its permissions when it is replaced", POSIX_ONLY, () => {
  for (const mode of [0o600, 0o640]) {
    const r = run({ outMode: mode });
    assert.equal(r.code, 0, r.error);
    assert.equal(r.outMode, mode);
    assert.match(r.text, /VERDICT/);
  }
});

test(
  "a launch identified as Codex, or an agent titled Codex, must confirm read-only",
  POSIX_ONLY,
  () => {
    const titled = run({
      agentName: "openai",
      agentTitle: "Codex",
      modes: ["default"],
      modeStart: "auto",
    });
    assert.equal(titled.code, 1, titled.error);
    assert.equal(
      titled.log.some((m) => m.method === "session/prompt"),
      false,
    );
    const byLaunch = run({
      ...CODEX_LAUNCH,
      agentName: "something-else",
      modes: ["default"],
      modeStart: "auto",
    });
    assert.equal(byLaunch.code, 1, byLaunch.error);
    assert.equal(
      byLaunch.log.some((m) => m.method === "session/prompt"),
      false,
    );
  },
);
test("a completed search titled as a web search counts under --no-web, a Grep does not", () => {
  const search = (/** @type {string} */ title) => ({
    toolUpdates: [
      { sessionUpdate: "tool_call", toolCallId: "s1", kind: "search", status: "completed", title },
    ],
  });
  assert.equal(run(search("Web search"), ["--no-web"]).code, 5);
  assert.equal(run(search("Web Search: weather"), ["--no-web"]).code, 5);
  assert.equal(run(search('Grep "Web search" in src'), ["--no-web"]).code, 0);
  assert.equal(run(search("Grep src"), ["--no-web"]).code, 0);
});
test("a web-search title sent on an earlier update, or on a call of another kind, still counts when the call completes", () => {
  const later = {
    toolUpdates: [
      {
        sessionUpdate: "tool_call",
        toolCallId: "s2",
        kind: "search",
        status: "in_progress",
        title: "Web search",
      },
      { sessionUpdate: "tool_call_update", toolCallId: "s2", status: "completed" },
    ],
  };
  assert.equal(run(later, ["--no-web"]).code, 5);
  const otherKind = {
    toolUpdates: [
      {
        sessionUpdate: "tool_call",
        toolCallId: "s3",
        kind: "read",
        status: "completed",
        title: "Web search",
      },
    ],
  };
  assert.equal(run(otherKind, ["--no-web"]).code, 5);
  assert.equal(run(later, []).code, 0, "without --no-web nothing counts");
});
test("a tool id the seat sends as an object with a broken toString is handled, not a crash", () => {
  const r = run(
    {
      toolUpdates: [
        {
          sessionUpdate: "tool_call",
          toolCallId: { toString: null },
          kind: "read",
          status: "completed",
          title: { toString: null },
        },
      ],
    },
    ["--no-web"],
  );
  assert.equal(r.code, 0, r.error);
  assert.doesNotMatch(r.error, /TypeError|Uncaught|at .*\.mjs/);
});
test("an exactly advertised model wins over a spelling-tolerant one, and two tolerant ones are refused", () => {
  const r = run({ modelValues: ["chosen", "vendor/chosen"] }, ["--model", "vendor/chosen"]);
  assert.equal(r.code, 0, r.error);
  const set = r.log.find(
    (m) => m.method === "session/set_config_option" && m.params.configId === "model",
  );
  assert.equal(set.params.value, "vendor/chosen");
  const ambiguous = run({ modelValues: ["chosen", "Chosen"] }, ["--model", "CHOSEN"]);
  assert.equal(ambiguous.code, 1);
  assert.match(ambiguous.error, /matches more than one advertised value/);
  assert.equal(
    ambiguous.log.some((m) => m.method === "session/prompt"),
    false,
  );
});
test("a Codex MCP list that is not a list of named servers refuses the launch", POSIX_ONLY, () => {
  for (const codexShim of [{}, { mcp_servers: [] }, [null], [{ name: 7 }]]) {
    const r = run({ ...CODEX_LAUNCH, codexShim });
    assert.equal(r.code, 2, JSON.stringify(codexShim));
    assert.match(r.error, /cannot turn off Codex's MCP servers/);
    assert.equal(r.launch, null);
  }
});
test(
  "a Devin config with a null MCP server entry refuses cleanly offline and is fine online",
  POSIX_ONLY,
  () => {
    const prepare = (/** @type {string} */ _r, /** @type {string} */ dir) => {
      mkdirSync(join(dir, "xdg", "devin"), { recursive: true });
      writeFileSync(
        join(dir, "xdg", "devin", "config.json"),
        JSON.stringify({ mcpServers: { legacy: null } }),
      );
    };
    const env = { XDG_CONFIG_HOME: "%DIR%/xdg" };
    const offline = run({ devinShim: true, env }, ["--no-web"], prepare);
    assert.equal(offline.code, 2, offline.error);
    assert.match(offline.error, /Devin MCP servers legacy/);
    assert.doesNotMatch(offline.error, /TypeError/);
    assert.equal(run({ devinShim: true, env }, [], prepare).code, 0);
  },
);

test("an agy launch is refused before any server starts unless the caller declares the seat masked", () => {
  for (const config of [
    { launcher: "agy" },
    { serverArgs: ["-c", "env X=1 agy acp"] },
    { serverArgs: ["--", "agy-acp"] },
    { serverArgs: ["/opt/agy-acp/current/agy_acp_server.par"] },
  ]) {
    for (const flags of [
      [],
      ["--policy-option", "agy-masked=false"],
      ["--policy-option", "agy-masked=yes"],
      ["--policy-option", "agy-masked-ish"],
    ]) {
      const r = run(config, flags);
      assert.equal(r.code, 2, `${JSON.stringify(config)} ${flags.join(" ")}`);
      assert.match(r.error, /\[client\] FATAL: the launch may start agy/);
      assert.match(r.error, /--policy-option agy-masked/);
      assert.equal(r.launch, null, "no server was started");
    }
  }
});
test("the agy-masked marker, bare or true, lets an agy launch through; other launches never need it", () => {
  for (const flags of [
    ["--policy-option", "agy-masked"],
    ["--policy-option", "agy-masked=true"],
  ]) {
    // The fake server ignores its arguments, so naming agy there stands for an agy launch on any OS.
    const r = run({ serverArgs: ["agy-acp"] }, flags);
    assert.equal(r.code, 0, r.error);
    assert.notEqual(r.launch, null, "the server started");
  }
  const other = run({}, []);
  assert.equal(other.code, 0, other.error);
});

test("a launch policy can neither set the agy-masked marker nor run before the agy refusal", () => {
  const r = run(
    { serverArgs: ["agy-acp"], readBack: ["policy-ran"] },
    ["--policy", "%DIR%/policy.mjs"],
    policyModule(`
import { writeFileSync } from "node:fs";
writeFileSync(new URL("./policy-ran", import.meta.url), "yes");
export default async ({ options }) => { options["agy-masked"] = "true"; };
`),
  );
  assert.equal(r.code, 2, r.error);
  assert.match(r.error, /FATAL: the launch may start agy/);
  assert.equal(r.launch, null);
  assert.equal(r.read["policy-ran"], null, "the policy module was not imported");
});
test(
  "a git program inside the review root on PATH is never the one the client runs",
  { skip: process.platform === "win32" },
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      mkdirSync(join(root, "bin"));
      writeFileSync(
        join(root, "bin", "git"),
        `#!/bin/sh\n: > "${join(dir, "git-ran")}"\nexit 0\n`,
        {
          mode: 0o755,
        },
      );
    };
    const r = run(
      { env: { PATH: `%DIR%/repo/bin:${process.env.PATH}` }, readBack: ["git-ran"] },
      [],
      prepare,
    );
    assert.equal(r.code, 0, r.error);
    assert.equal(r.read["git-ran"], null, "the checkout's git did not run");
  },
);
test(
  "with no git outside the review root the comparison is skipped, not run with the checkout's git",
  { skip: process.platform === "win32" },
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      mkdirSync(join(root, "bin"));
      writeFileSync(
        join(root, "bin", "git"),
        `#!/bin/sh\n: > "${join(dir, "git-ran")}"\nexit 0\n`,
        {
          mode: 0o755,
        },
      );
    };
    const r = run({ env: { PATH: "%DIR%/repo/bin" }, readBack: ["git-ran"] }, [], prepare);
    assert.equal(r.code, 0, r.error);
    assert.equal(r.read["git-ran"], null, "the checkout's git did not run");
  },
);

test(
  "a bun server never reads the checkout's bunfig.toml preload or .env",
  { skip: process.platform === "win32" },
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      writeFileSync(join(root, "bunfig.toml"), 'preload = ["./pre.mjs"]\n');
      writeFileSync(
        join(root, "pre.mjs"),
        `await Bun.write(${JSON.stringify(join(dir, "preload-ran"))}, "1");\n`,
      );
      writeFileSync(join(root, ".env"), "PROBE_FROM_ENV=1\nACP_PROBE_HOME=/from/checkout\n");
    };
    const r = run(
      { env: { ACP_PANEL_PASS_ENV: "PROBE_,ACP_PROBE_,FAKE_" }, readBack: ["preload-ran"] },
      [],
      prepare,
    );
    assert.equal(r.code, 0, r.error);
    assert.equal(r.read["preload-ran"], null, "the checkout's preload did not run in the server");
    assert.ok(r.launch, "the server started");
    assert.equal(
      r.launch.env.includes("PROBE_FROM_ENV"),
      false,
      "the checkout's .env was not loaded",
    );
    assert.equal(r.launch.env.includes("ACP_PROBE_HOME"), false);
  },
);

test(
  "a git program anywhere in the checkout is refused, also when launched from below the repository root",
  { skip: process.platform === "win32" },
  () => {
    const prepare = (/** @type {string} */ root, /** @type {string} */ dir) => {
      gitRepoWithTracked(root);
      mkdirSync(join(root, "bin"));
      mkdirSync(join(root, "packages", "app"), { recursive: true });
      writeFileSync(join(root, "packages", "app", "a.txt"), "x");
      writeFileSync(
        join(root, "bin", "git"),
        `#!/bin/sh\n: > "${join(dir, "git-ran")}"\nexit 0\n`,
        {
          mode: 0o755,
        },
      );
      return join(root, "packages", "app");
    };
    const r = run(
      { env: { PATH: `%DIR%/repo/bin:${process.env.PATH}` }, readBack: ["git-ran"] },
      [],
      prepare,
    );
    assert.equal(r.code, 0, r.error);
    assert.equal(r.read["git-ran"], null, "the checkout's git did not run");
  },
);
