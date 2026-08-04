import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/block-bloc-viewer', TH=path.resolve('node_modules/three');
const send=(r,f)=>{r.writeHead(200,{'Content-Type':f.endsWith('.json')?'application/json':f.endsWith('.html')?'text/html':'text/javascript'});fs.createReadStream(f).pipe(r);};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);
  if(u==='/vendor/three.js')return send(r,path.join(TH,'build/three.module.js'));
  if(u.startsWith('/vendor/addons/')){const f=path.join(TH,'examples/jsm',u.slice(15));if(fs.existsSync(f))return send(r,f);}
  if(u.startsWith('/vendor/')){const f=path.join(TH,'build',u.slice(8));if(fs.existsSync(f))return send(r,f);}
  if(u==='/roomplanner.html'){const h=fs.readFileSync(path.join(ROOT,'roomplanner.html'),'utf8')
    .replace('https://esm.sh/three@0.180.0/examples/jsm/','/vendor/addons/').replace('https://esm.sh/three@0.180.0','/vendor/three.js');
    r.writeHead(200,{'Content-Type':'text/html'});return r.end(h);}
  const f=path.join(ROOT,u); if(!fs.existsSync(f)){r.writeHead(404);return r.end();} send(r,f);});
await new Promise(r=>srv.listen(8937,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const W=1440,H=960;
const p=await b.newPage({viewport:{width:W,height:H}});
await p.goto('http://127.0.0.1:8937/roomplanner.html',{waitUntil:'load'});
await p.waitForTimeout(9000);
await p.addStyleTag({content:'#side,#help,#insp,#hud,#layouts,#modes,#toast{display:none!important}'});

const POSES = [
  { name:'axis',   x:3.10, y:1.90, z:1.55, tx:2.10, ty:7.60, tz:1.35, fov:55 },
  { name:'corner', x:2.60, y:3.20, z:1.55, tx:6.00, ty:0.30, tz:1.25, fov:55 },
];
const truths = {};
for (const g of POSES) {
  await p.evaluate((g)=>{
    const {S,THREE,fly}=window.DEBUG; const c=window.DEBUG.camera;
    const toThree=(x,y,h)=>new THREE.Vector3(x-S.cx,h,-(y-S.cy));
    c.fov=g.fov; c.updateProjectionMatrix();
    const pos=toThree(g.x,g.y,g.z), tgt=toThree(g.tx,g.ty,g.tz);
    const f=tgt.clone().sub(pos).normalize();
    fly.pos.copy(pos); fly.pitch=Math.asin(f.y); fly.yaw=Math.atan2(-f.x,-f.z);
    fly.keys.clear(); fly.on=true;
  }, g);
  await p.waitForTimeout(1600);
  await p.screenshot({ path:`gt-${g.name}.png` });
  truths[g.name] = await p.evaluate((h)=>{
    const c=window.DEBUG.camera;
    const e=new (window.DEBUG.THREE.Euler)().setFromQuaternion(c.quaternion,'YXZ');
    return { fov:c.fov, focal_px:+((h/2)/Math.tan(c.fov*Math.PI/360)).toFixed(1),
             yaw_deg:+(e.y*180/Math.PI).toFixed(2), pitch_deg:+(e.x*180/Math.PI).toFixed(2) };
  }, H);
  console.log(g.name.padEnd(7), JSON.stringify(truths[g.name]));
}
fs.writeFileSync('gt-truth.json', JSON.stringify(truths,null,1));
await b.close(); srv.close();
