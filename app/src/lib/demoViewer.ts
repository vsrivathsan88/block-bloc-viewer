// Self-contained stand-in for the splat viewer, used when the real viewer's
// CDNs are unreachable (VITE_DEMO builds — e.g. the hosted preview). Renders
// a blockout room with a tiny canvas-2D 3D projector and implements the same
// window.DEBUG contract the real viewer exposes (camera pose get/set,
// renderer.domElement, __recording), so Scout/plan/shoot/capture all work.
// Fitting, since block-bloc worlds literally start as blockouts.

export const DEMO_MODE = !!import.meta.env.VITE_DEMO;

/** The living-room demo world new projects start in. */
export const DEMO_SPZ = "https://cdn.marble.worldlabs.ai/bd1c3e7a-e412-4950-bb82-045f95f047a5/0dea05c6-6b15-4d51-bc0d-5f46b5e3df5a_ceramic_500k.spz";

export const DEMO_VIEWER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:#101018}
canvas{display:block;cursor:grab}
#hint{position:fixed;bottom:10px;left:10px;color:#cfd2e2;background:rgba(10,10,16,.7);
font:11px ui-monospace,monospace;padding:6px 10px;border-radius:8px;pointer-events:none}
</style></head><body>
<div id="hint">demo blockout set &middot; drag to look &middot; WASD to walk</div>
<canvas id="c"></canvas>
<script>
(function(){
"use strict";
var canvas=document.getElementById("c"),ctx=canvas.getContext("2d");
function resize(){canvas.width=innerWidth;canvas.height=innerHeight;cam.aspect=innerWidth/innerHeight;}
var yaw=2.6,pitch=0;
var cam={
  position:{x:0,y:0,z:0,set:function(a,b,c){this.x=a;this.y=b;this.z=c;}},
  quaternion:{x:0,y:0,z:0,w:1,set:function(a,b,c,d){this.x=a;this.y=b;this.z=c;this.w=d;syncFromQuat();}},
  fov:65,aspect:1
};
window.DEBUG={camera:cam,renderer:{domElement:canvas},
  worldBboxXZ:{min:[-3,-3.6],max:[3,3.6]}};
window.__recording=false;
resize();addEventListener("resize",resize);

// --- quaternion helpers (XYZW) ---
function qMul(a,b){return [
  a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
  a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
  a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
  a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qRotInv(q,v){ // rotate v by conjugate(q)
  var c=[-q[0],-q[1],-q[2],q[3]];
  var x=v[0],y=v[1],z=v[2];
  var ix=c[3]*x+c[1]*z-c[2]*y, iy=c[3]*y+c[2]*x-c[0]*z, iz=c[3]*z+c[0]*y-c[1]*x, iw=-c[0]*x-c[1]*y-c[2]*z;
  return [ix*c[3]+iw*-c[0]+iy*-c[2]-iz*-c[1], iy*c[3]+iw*-c[1]+iz*-c[0]-ix*-c[2], iz*c[3]+iw*-c[2]+ix*-c[1]-iy*-c[0]];}
function qRot(q,v){
  var x=v[0],y=v[1],z=v[2];
  var ix=q[3]*x+q[1]*z-q[2]*y, iy=q[3]*y+q[2]*x-q[0]*z, iz=q[3]*z+q[0]*y-q[1]*x, iw=-q[0]*x-q[1]*y-q[2]*z;
  return [ix*q[3]+iw*-q[0]+iy*-q[2]-iz*-q[1], iy*q[3]+iw*-q[1]+iz*-q[0]-ix*-q[2], iz*q[3]+iw*-q[2]+ix*-q[1]-iy*-q[0]];}
function setQuatFromYawPitch(){
  var qy=[0,Math.sin(yaw/2),0,Math.cos(yaw/2)], qx=[Math.sin(pitch/2),0,0,Math.cos(pitch/2)];
  var q=qMul(qy,qx);
  cam.quaternion.x=q[0];cam.quaternion.y=q[1];cam.quaternion.z=q[2];cam.quaternion.w=q[3];}
function syncFromQuat(){
  var q=[cam.quaternion.x,cam.quaternion.y,cam.quaternion.z,cam.quaternion.w];
  var f=qRot(q,[0,0,-1]);
  yaw=Math.atan2(-f[0],-f[2]);pitch=Math.asin(Math.max(-1,Math.min(1,f[1])));}
setQuatFromYawPitch();

// --- the blockout set (meters; camera eye height y=0, floor -1.55) ---
var FLOOR=-1.55,CEIL=1.15,X0=-3,X1=3,Z0=-3.6,Z1=3.6;
function tileQuads(corners,nu,nv,color,alt){ // subdivided quad -> tiles (near-clip friendly)
  var out=[],a=corners[0],b=corners[1],c=corners[2],d=corners[3];
  function lerp(p,q,t){return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,p[2]+(q[2]-p[2])*t];}
  for(var i=0;i<nu;i++)for(var j=0;j<nv;j++){
    var u0=i/nu,u1=(i+1)/nu,v0=j/nv,v1=(j+1)/nv;
    out.push({pts:[lerp(lerp(a,b,u0),lerp(d,c,u0),v0),lerp(lerp(a,b,u1),lerp(d,c,u1),v0),
                   lerp(lerp(a,b,u1),lerp(d,c,u1),v1),lerp(lerp(a,b,u0),lerp(d,c,u0),v1)],
              color:(alt&&(i+j)%2)?alt:color});}
  return out;}
function box(x0,y0,z0,x1,y1,z1,color,top){
  var q=[];
  q.push({pts:[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],color:top||color});
  q.push({pts:[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]],color:shade(color,.85)});
  q.push({pts:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],color:shade(color,.75)});
  q.push({pts:[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],color:shade(color,.7)});
  q.push({pts:[[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],color:shade(color,.9)});
  return q;}
function shade(hex,f){
  var r=parseInt(hex.slice(1,3),16)*f,g=parseInt(hex.slice(3,5),16)*f,b=parseInt(hex.slice(5,7),16)*f;
  return "rgb("+(r|0)+","+(g|0)+","+(b|0)+")";}
var quads=[];
quads=quads.concat(tileQuads([[X0,FLOOR,Z0],[X1,FLOOR,Z0],[X1,FLOOR,Z1],[X0,FLOOR,Z1]],6,7,"#a8a094","#b3aa9d"));
quads=quads.concat(tileQuads([[X0,CEIL,Z0],[X1,CEIL,Z0],[X1,CEIL,Z1],[X0,CEIL,Z1]],3,4,"#d9d6cd"));
quads=quads.concat(tileQuads([[X0,FLOOR,Z0],[X1,FLOOR,Z0],[X1,CEIL,Z0],[X0,CEIL,Z0]],6,3,"#8e9ab0"));
quads=quads.concat(tileQuads([[X0,FLOOR,Z1],[X1,FLOOR,Z1],[X1,CEIL,Z1],[X0,CEIL,Z1]],6,3,"#98a5ba"));
quads=quads.concat(tileQuads([[X0,FLOOR,Z0],[X0,FLOOR,Z1],[X0,CEIL,Z1],[X0,CEIL,Z0]],7,3,"#8a97ae"));
quads=quads.concat(tileQuads([[X1,FLOOR,Z0],[X1,FLOOR,Z1],[X1,CEIL,Z1],[X1,CEIL,Z0]],7,3,"#a2adc2"));
// window (north wall) + door (east wall)
quads.push({pts:[[-1.1,-0.5,Z0+0.02],[1.1,-0.5,Z0+0.02],[1.1,0.85,Z0+0.02],[-1.1,0.85,Z0+0.02]],color:"#eaf2fc",glow:true});
quads.push({pts:[[X1-0.02,FLOOR,1.6],[X1-0.02,FLOOR,2.5],[X1-0.02,0.6,2.5],[X1-0.02,0.6,1.6]],color:"#4a4238"});
// furniture blockouts
quads=quads.concat(box(-1.3,FLOOR,2.0,1.0,FLOOR+0.75,2.9,"#5b7ea6"));       // sofa
quads=quads.concat(box(-0.6,FLOOR,0.3,0.6,FLOOR+0.42,1.1,"#b07d5a"));        // coffee table
quads=quads.concat(box(1.9,FLOOR,-2.9,2.8,FLOOR+1.9,-2.2,"#7d6b8f"));        // shelf
quads=quads.concat(box(-2.8,FLOOR,-1.4,-2.2,FLOOR+0.9,-0.2,"#6f8f7a"));      // plant/console

function render(){
  var w=canvas.width,h=canvas.height;
  ctx.fillStyle="#14141d";ctx.fillRect(0,0,w,h);
  var q=[cam.quaternion.x,cam.quaternion.y,cam.quaternion.z,cam.quaternion.w];
  var pos=[cam.position.x,cam.position.y,cam.position.z];
  var f=(h/2)/Math.tan(cam.fov*Math.PI/360);
  var drawn=[];
  for(var i=0;i<quads.length;i++){
    var poly=quads[i],pts2=[],depth=0,ok=true;
    for(var j=0;j<4;j++){
      var p=poly.pts[j];
      var pc=qRotInv(q,[p[0]-pos[0],p[1]-pos[1],p[2]-pos[2]]);
      if(pc[2]>-0.08){ok=false;break;}
      depth+=pc[2];
      pts2.push([w/2+pc[0]*f/(-pc[2]),h/2-pc[1]*f/(-pc[2])]);
    }
    if(ok)drawn.push({pts:pts2,depth:depth/4,color:poly.color,glow:poly.glow});
  }
  drawn.sort(function(a,b){return a.depth-b.depth;});
  for(var k=0;k<drawn.length;k++){
    var d=drawn[k];
    ctx.beginPath();
    ctx.moveTo(d.pts[0][0],d.pts[0][1]);
    for(var m=1;m<4;m++)ctx.lineTo(d.pts[m][0],d.pts[m][1]);
    ctx.closePath();
    ctx.fillStyle=d.color;ctx.fill();
    if(d.glow){ctx.strokeStyle="#c8d8ee";ctx.lineWidth=2;ctx.stroke();}
  }
}

// --- input: drag look (pointer-lock-free, works in sandboxed iframes) ---
var dragging=false,lx=0,ly=0;
canvas.addEventListener("pointerdown",function(e){dragging=true;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointermove",function(e){
  if(!dragging||window.__recording)return;
  yaw-=(e.clientX-lx)*0.005;pitch=Math.max(-1.3,Math.min(1.3,pitch-(e.clientY-ly)*0.005));
  lx=e.clientX;ly=e.clientY;setQuatFromYawPitch();});
canvas.addEventListener("pointerup",function(){dragging=false;});
var keys={};
addEventListener("keydown",function(e){keys[e.code]=true;});
addEventListener("keyup",function(e){keys[e.code]=false;});
addEventListener("blur",function(){keys={};});
canvas.addEventListener("click",function(){canvas.focus();});
canvas.tabIndex=0;

var prev=performance.now();
function loop(t){
  var dt=Math.min((t-prev)/1000,0.05);prev=t;
  if(!window.__recording){
    var fwd=(keys.KeyW?1:0)-(keys.KeyS?1:0),str=(keys.KeyD?1:0)-(keys.KeyA?1:0);
    if(fwd||str){
      var sp=1.8*(keys.ShiftLeft||keys.ShiftRight?2:1)*dt;
      cam.position.x+=(-Math.sin(yaw)*fwd+Math.cos(yaw)*str)*sp;
      cam.position.z+=(-Math.cos(yaw)*fwd-Math.sin(yaw)*str)*sp;
      cam.position.x=Math.max(X0+0.3,Math.min(X1-0.3,cam.position.x));
      cam.position.z=Math.max(Z0+0.3,Math.min(Z1-0.3,cam.position.z));
    }
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
<\/script></body></html>`;
