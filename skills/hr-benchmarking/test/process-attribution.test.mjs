import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const collector = fileURLToPath(new URL("../scripts/process-attribution.py", import.meta.url));
test(
  "Linux attribution excludes reused PIDs, charges reaped children and preserves CPU units and names",
  { skip: process.platform !== "linux" },
  () => {
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
import importlib.util,sys,tempfile,pathlib,types
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('collector',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def sample(birth,cpu,at):return {'monotonic':at,'utc':'test','hostBusyTicks':cpu,'processes':{7:{'name':'name with ) bracket','parentPid':1,'cpuTicks':cpu,'birthTicks':birth,'rssPages':1}}}
a=sample('10',10,1);b=sample('11',20,2)
v=m.compare(a,b,100);assert v['processCpu']==[] and v['unmatchedBefore']==v['unmatchedAfter']==1
b=sample('10',20,2);v=m.compare(a,b,100);assert v['processCpu'][0]['busyCores']==.1
a['processes'][7]['reapedChildCpuTicks']=5;b=sample('10',10,2);b['processes'][7]['reapedChildCpuTicks']=55
v=m.compare(a,b,100);assert v['processCpu'][0]['busyCores']==0 and v['processCpu'][0]['reapedChildCores']==.5
a['cpuBusyTicks']={'0':10,'1':10};b['cpuBusyTicks']={'0':110,'1':10};assert m.compare(a,b,100)['cpuBusyCores']=={'0':1.0,'1':0.0}
stat='7 (name with ) bracket) '+' '.join(['S','1']+['0']*9+['10','20','3','4']+['0']*4+['123','0','4'])
v=m.read_process(stat);assert v['name']=='name with ) bracket' and v['birthTicks']=='123' and v['cpuTicks']==30 and v['reapedChildCpuTicks']==7 and v['rssPages']==4
with tempfile.TemporaryDirectory(dir=sys.argv[2]) as directory:
 root=pathlib.Path(directory);(root/'7').mkdir();(root/'7/stat').write_bytes(stat.encode().replace(b'name with ) bracket', b'name with '+bytes([255])+b' bracket'))
 (root/'self').mkdir();(root/'self/status').write_text('VmHWM: 37 kB\\n')
 (root/'stat').write_text('cpu 1 2 3 4 5 6 7 8\\ncpu0 1 2 3 4 5 6 7 8\\nintr 1\\n')
 inherited=types.SimpleNamespace(ru_utime=1,ru_stime=2,ru_maxrss=99999999)
 with patch.object(m.resource,'getrusage',return_value=inherited):
  snapshot=m.snapshot(root)
  assert snapshot['observerPeakRssBytes']==37*1024
  assert snapshot['processes'][7]['name']=='name with \ufffd bracket'
  assert snapshot['processes'][7]['cpuTicks']==30 and snapshot['missingProcesses']==0
  assert snapshot['hostBusyTicks']==19 and snapshot['cpuBusyTicks']=={'0':19}

`,
        collector,
        process.env.TMPDIR || process.cwd(),
      ],
      { encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    assert.equal(result.status, 0, result.stderr || String(result.error));
  },
);
