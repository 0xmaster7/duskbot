import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_IMAGE_DIGEST, CUA_DRIVER_VERSION, IMAGE, IMAGE_LAYER_VERSION } from "../../server/container-computer.ts";
import { fakeDesktopFrame } from "./fake-desktop-frame.ts";
import { fakeVnc } from "./fake-vnc.ts";

export async function createTeamVpsFixture(options: { frames?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "omb-team-vps-fixture-"));
  const binDir = join(directory, "bin");
  const records = join(directory, "computers");
  mkdirSync(binDir);
  mkdirSync(records);
  const desktop = await fakeVnc();
  const calls = join(directory, "docker-calls.jsonl");
  const frame = join(directory, "frame.b64");
  writeFileSync(calls, "");
  writeFileSync(frame, fakeDesktopFrame(0, 1).toString("base64"));
  writeFileSync(join(binDir, "docker"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const records = ${JSON.stringify(records)};
let args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args[0] === '-H') args = args.slice(2);
const image = 'sha256:' + 'a'.repeat(64);
const labels = {'com.openmausbot.local-vm':'1','com.openmausbot.cua-driver':${JSON.stringify(CUA_DRIVER_VERSION)},
  'com.openmausbot.cua-base':${JSON.stringify(BASE_IMAGE_DIGEST)},'com.openmausbot.image-layer':${JSON.stringify(IMAGE_LAYER_VERSION)}};
const rows = () => fs.readdirSync(records).map(name => JSON.parse(fs.readFileSync(path.join(records,name),'utf8')));
const save = row => fs.writeFileSync(path.join(records,row.Id+'.json'),JSON.stringify(row));
const make = name => ({Id:crypto.createHash('sha256').update(name).digest('hex'),Name:'/'+name,Image:image,
  Config:{Image:${JSON.stringify(IMAGE)},Env:['VNC_PW=fixture-only'],Labels:{...labels,'com.openmausbot.vps':'1','com.openmausbot.container':name,'com.openmausbot.vps-viewer':'1'}},
  State:{Running:true,Status:'running'},Mounts:[],
  HostConfig:{Binds:[],VolumesFrom:[],NetworkMode:'bridge',PortBindings:{},PublishAllPorts:false,Memory:4294967296,MemorySwap:4294967296,
    NanoCpus:2000000000,PidsLimit:4096,CapDrop:['ALL'],CapAdd:['CAP_SETUID','CAP_SETGID'],Privileged:false,PidMode:'',IpcMode:'private',
    UTSMode:'',ShmSize:536870912,Devices:[],DeviceRequests:[],SecurityOpt:[],UsernsMode:'',CgroupnsMode:'private',
    OomKillDisable:false,AutoRemove:false,RestartPolicy:{Name:'unless-stopped',MaximumRetryCount:0}},
  NetworkSettings:{Networks:{bridge:{IPAddress:'172.17.0.5'}}}});
const find = ref => rows().find(row => row.Id === ref || row.Name === '/'+ref);
const missing = () => {process.stderr.write('No such container');process.exit(1)};
const screenshot = () => {
  if (!${JSON.stringify(options.frames === true)}) return fs.readFileSync(${JSON.stringify(frame)},'utf8');
  const row=find(args.find(value=>/^[a-f0-9]{64}$/.test(value)));
  if(!row)missing();
  row.captureTick=(row.captureTick||0)+1;save(row);
  return require(${JSON.stringify(fileURLToPath(new URL("./fake-desktop-frame.ts", import.meta.url)))}).fakeDesktopFrame(parseInt(row.Id.slice(0,6),16),row.captureTick).toString('base64');
};
let out;
if (args[0] === 'image' && args[1] === 'inspect') out = [{Id:image,Config:{Labels:labels}}];
else if (args[0] === 'inspect') {
  const name = args[1];
  if (!/^openmausbot-vps-[a-z0-9-]+$/.test(name)) missing();
  const row = find(name) || make(name);save(row);out = [row];
} else if (args[0] === 'container' && args[1] === 'ls') out = rows().map(row => row.Id).join('\\n');
else if (args[0] === 'container' && args[1] === 'inspect') {out=args.slice(2).map(find);if(out.some(row=>!row))missing();}
else if (['start','stop','rm'].includes(args[0])) {
  const row=find(args.at(-1));if(!row)missing();
  if(args[0]==='rm')fs.unlinkSync(path.join(records,row.Id+'.json'));
  else {row.State={Running:args[0]==='start',Status:args[0]==='start'?'running':'exited'};save(row);}out='';
} else if (args[0] === 'exec') {
  out = args.includes('base64') || args.some(arg=>arg.includes('base64 <')) ? screenshot()
    : args.includes('--version') ? 'cua-driver ${CUA_DRIVER_VERSION}'
    : args.includes('omb-desktop-probe') || args.includes('health_report') ? {schema_version:'1',overall:'ok',checks:[]} : {};
} else if (args[0] === 'info') out='fixture';
else if (args[0] === 'ps') out='';
else {process.stderr.write('unsupported fixture command');process.exit(64);}
process.stdout.write(typeof out==='string'?out:JSON.stringify(out));
`, { mode: 0o700 });
  writeFileSync(join(binDir, "ssh"), `#!${process.execPath}
const net=require('node:net');
const args=process.argv.slice(2);
const forward=args[args.indexOf('-L')+1];
if(!args.includes('-N') || !/^127\\.0\\.0\\.1:[0-9]+:172\\.17\\.0\\.5:6901$/.test(forward))process.exit(64);
const sockets=new Set();
const server=net.createServer(client=>{
  const peer=net.connect(${desktop.port},'127.0.0.1');
  for(const socket of [client,peer]){sockets.add(socket);socket.on('error',()=>socket.destroy());socket.on('close',()=>{sockets.delete(socket);client.destroy();peer.destroy()});}
  client.pipe(peer).pipe(client);
});
server.listen(Number(forward.split(':')[1]),'127.0.0.1');
process.on('SIGTERM',()=>{server.close();for(const socket of sockets)socket.destroy()});
`, { mode: 0o700 });
  return {
    calls,
    localVm: { binDir, host: "ssh://127.0.0.1:1", sshKey: join(directory, "unused-key"), staticDir: fileURLToPath(new URL("../../dist", import.meta.url)) },
    async close() { await desktop.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
