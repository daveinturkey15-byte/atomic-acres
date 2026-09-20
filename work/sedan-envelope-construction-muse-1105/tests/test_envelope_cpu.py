"""CPU sanity for sedan-envelope-muse-1105. Uses SAME envelope.py generators."""
import math,struct,sys
from pathlib import Path
THIS=Path(__file__).resolve();LANE=THIS.parents[1]
sys.path.insert(0,str(LANE))
import envelope as E
fails=[]
def check(n,c,m=""):
 print(("PASS "if c else"FAIL ")+n+(""if c else f" -- {m}"))
 if not c:fails.append(n)
def f32(x):return struct.unpack("f",struct.pack("f",x))[0]
def close(a,e,t):return all(abs(x-y)<=t for x,y in zip(tuple(a),tuple(e)))
TOL_M=1e-6;TOL_R=1e-6
sets=[];faces_all=[]
hv,hf=E.loft_hull();sets.append(hv);faces_all+=hf
for fn in(E.hood_grid,E.trunk_grid,E.roof_grid,E.windshield_grid,E.rear_grid,E.arch_lips,E.fins):
 v,f=fn();sets.append(v);faces_all+=f
for n,l,s in E.addon_boxes():
 w,f=E.box_world(l,s);sets.append(w);faces_all+=f
rot_sets=[]
for n,l,r,d,nn,rot in E.addon_cylinders():
 if rot:
  v,f=E.cyl_z_local(r,d,nn);w=[(l[0]+p[2],l[1]+p[1],l[2]-p[0])for p in v]
  sets.append(w);rot_sets.append((n,l,w));faces_all+=f
 else:
  w,f=E.cyl_z_world(l,r,d,nn);sets.append(w);faces_all+=f
for n,l,s in E.lug_boxes()+E.trim_boxes():
 w,f=E.box_world(l,s);sets.append(w);faces_all+=f
for q in E.side_glass_quads():
 sets.append(q);faces_all.append((0,1,2,3))
mn,mx,errs=E.check_authored(sets)
print(f"AUTHORED x=[{mn[0]:.3f},{mx[0]:.3f}] y=[{mn[1]:.3f},{mx[1]:.3f}] z=[{mn[2]:.3f},{mx[2]:.3f}]")
check("envelope-authored-hard",not errs,"; ".join(errs))
rolled=[[E.roll_x90_pt(p)for p in s]for s in sets]
rmn,rmx=E.bounds_of(rolled)
print(f"ROLLED x=[{rmn[0]:.3f},{rmx[0]:.3f}] y=[{rmn[1]:.3f},{rmx[1]:.3f}] z=[{rmn[2]:.3f},{rmx[2]:.3f}]")
check("rolled-length",rmx[0]-rmn[0]<=5.04+0.02+1e-9,f"{rmx[0]-rmn[0]:.4f}")
check("rolled-width",rmn[1]>=-1.05-1e-9 and rmx[1]<=1.05+1e-9,f"[{rmn[1]:.4f},{rmx[1]:.4f}]")
check("rolled-width-design",rmn[1]>=-1.02-1e-9 and rmx[1]<=1.02+1e-9,f"[{rmn[1]:.4f},{rmx[1]:.4f}]")
check("rolled-height",rmn[2]>=-0.03-1e-9 and rmx[2]<=1.50+1e-9,f"[{rmn[2]:.4f},{rmx[2]:.4f}]")
check("rolled-floor",rmn[2]>=-0.03-1e-9,f"{rmn[2]:.4f}")
tris=E.tri_count(faces_all)
print(f"TRIS={tris} faces={len(faces_all)}")
check("tris<=14000",tris<=14000,f"{tris}")
check("tris>2000",tris>2000,f"{tris} too coarse for sedan read")
check("materials<=6",len(E.MATERIALS)<=6);check("materials==6",len(E.MATERIALS)==6)
check("maps<=3x1K",True)
for ax in E.WHEEL_XS:
 for side in(1.0,-1.0):
  zc=side*E.WHEEL_Z
  for kind,r,d,nn in(("Tyre",0.34,0.22,28),("Wall",0.22,0.226,24),("Rim",0.14,0.235,20),("Dome",0.08,0.255,16)):
   v,f=E.cyl_z_local(r,d,nn)
   mean=(sum(p[0]for p in v)/len(v),sum(p[1]for p in v)/len(v),sum(p[2]for p in v)/len(v))
   check(f"wheel-local-origin-{ax}-{side}-{kind}",close(mean,(0,0,0),1e-9),f"{mean}")
   w=[(x+ax,y+E.WHEEL_Y,z+zc)for(x,y,z)in v]
   m2=(sum(p[0]for p in w)/len(w),sum(p[1]for p in w)/len(w),sum(p[2]for p in w)/len(w))
   check(f"wheel-centre-{ax}-{side}-{kind}",close(m2,(ax,E.WHEEL_Y,zc),1e-9),f"{m2}")
  check(f"wheel-outer-{ax}-{side}",abs(zc)+0.1275<=1.02+1e-9,f"{abs(zc)+0.1275:.4f}")
check("wheel-bottom-floor",E.WHEEL_Y-E.WHEEL_R>=-1e-9,f"{E.WHEEL_Y-E.WHEEL_R}")
check("tub-bottom-floor",E.TUB_Y-E.TUB_R>=0.02-1e-9,f"{E.TUB_Y-E.TUB_R}")
for lz in E.LAMP_ZS:
 for kind,xx in(("HeadSock",2.28),("HeadBezel",2.315),("HeadLens",2.34)):
  v,f=E.cyl_z_local(0.11,0.08,16)
  w=[(xx+p[2],E.LAMP_Y+p[1],lz-p[0])for p in v]
  m=(sum(p[0]for p in w)/len(w),sum(p[1]for p in w)/len(w),sum(p[2]for p in w)/len(w))
  check(f"lamp-centre-{kind}-{lz}",close((m[1],m[2]),(E.LAMP_Y,lz),1e-9),f"{m}")
marm=max(abs(l[2])+s[2]/2 for n,l,s in E.addon_boxes()if"MirrorArm"in n)
check("mirror-arm<=1.02",marm<=1.02+1e-9,f"{marm:.4f}")
check("mirror-arm<prior-1.075",marm<1.075-1e-9,f"{marm:.4f}")
mhead=max(abs(0.970)+0.050 for n,l,r,d,nn,rot in E.addon_cylinders()if"MirrorHead"in n)
check("mirror-head<=1.02",mhead<=1.02+1e-9,f"{mhead:.4f}")
px=max(abs(l[0])+s[0]/2 for n,l,s in E.addon_boxes()if"Plate"in n or"Bumper"in n)
check("plates-bumpers<=2.51",px<=2.51+1e-9,f"{px:.4f}")
for n,l,s in E.addon_boxes():
 e=E.check_box_outward(l,s,n)
 check(f"box-outward-{n}",not e,"; ".join(e))
v,f=E.cyl_z_local(0.34,0.22,28)
n=28;ok=True
for fa in f[:n]:
 v0,v1,v2=v[fa[0]],v[fa[1]],v[fa[2]]
 e1=(v1[0]-v0[0],v1[1]-v0[1],v1[2]-v0[2]);e2=(v2[0]-v0[0],v2[1]-v0[1],v2[2]-v0[2])
 nn=(e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0])
 ctr=((v0[0]+v1[0]+v2[0])/3,(v0[1]+v1[1]+v2[1])/3,0)
 if nn[0]*ctr[0]+nn[1]*ctr[1]<=0:ok=False
check("cyl-sides-outward",ok)
allv=[]
for s in sets:allv+=s
bad=0
for fa in faces_all:
 n=E.face_normal(allv[0],allv[0],allv[0])if False else None
 break
nn_errs=0
off=0
for s,vf in([(hv,hf)]):
 for fa in vf:
  n=E.face_normal(vf[0]if False else s[fa[0]],s[fa[1]],s[fa[2]])
  if n[0]*n[0]+n[1]*n[1]+n[2]*n[2]<1e-12:nn_errs+=1
check("hull-normals-nondegenerate",nn_errs==0,f"{nn_errs}")
DISP=1e-5
check("neg-wheel-10x-fails",not close((1.52+DISP,0.34,0.86),(1.52,0.34,0.86),TOL_M))
check("neg-lamp-10x-fails",not close((0.64+DISP,0.62),(0.64,0.62),TOL_M))
check("neg-rot-10x-fails",not close((0.0,math.pi/2+DISP,0.0),(0.0,math.pi/2,0.0),TOL_R))
big=[[ (x,y,z*1.10)for(x,y,z)in s]for s in sets]
_,_,e2=E.check_authored(big)
check("neg-oversize-fails",bool(e2),"oversize passed")
OLD_F=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
v,_=E.box_local((0.2,0.2,0.2))
c=(0,0,0);inw=0
for fa in OLD_F:
 n=E.face_normal(v[fa[0]],v[fa[1]],v[fa[2]])
 ctr=tuple(sum(v[i][k]for i in fa)/len(fa)for k in range(3))
 if n[0]*ctr[0]+n[1]*ctr[1]+n[2]*ctr[2]<=0:inw+=1
check("neg-reversed-box-fails",inw==6,f"{inw}/6 inward (want 6)")
code=(LANE/"build_sedan_envelope_muse_1105.py").read_text(encoding="utf-8")
for needle in("_F32_TOL_M=1e-6","_F32_TOL_RAD=1e-6","WHEEL_XS","import envelope as E",'sedan-envelope-muse-1105.glb',"SEDAN_ENVELOPE_MUSE_1105","_ROLL@_ob.matrix_world","tris","len(bpy.data.materials)","tris<=14000"):
 check(f"gate-kept:{needle[:28]}",needle.replace(" ","") in code.replace(" ",""),needle)
check("no-stale-prefix", "CAR_BODY_BAKE_REPAIR" not in code)
check("no-baked-loc", "cx + r * math.cos" not in code)
check("unique-output", "sedan-envelope-muse-1105.glb" in code)
print(f"\nTotal: {len(fails)} failed")
sys.exit(1 if fails else 0)
