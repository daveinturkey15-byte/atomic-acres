"""Sedan envelope-first Blender recipe (muse-1105). CPU geometry in envelope.py."""
import math,sys,time
from pathlib import Path
THIS=Path(__file__).resolve();LANE=THIS.parent
sys.path.insert(0,str(LANE))
import envelope as E
import bpy
_F32_TOL_M=1e-6;_F32_TOL_RAD=1e-6
def _close_seq(a,e,t):return all(abs(x-y)<=t for x,y in zip(tuple(a),tuple(e)))
SEED=1105;OUT_GLB=LANE/"output"/"sedan-envelope-muse-1105.glb"
BODY_HEX=0x28374F;CREAM_HEX=0xE8E0CD;CHROME_HEX=0xC8CCD0;GLASS_HEX=0x66808E;TRIM_HEX=0x2E3238;SIGNAL_HEX=0xA8302C
T0=time.perf_counter()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for coll in(bpy.data.meshes,bpy.data.materials,bpy.data.images,bpy.data.cameras,bpy.data.lights):
 for x in list(coll):coll.remove(x)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1.0
def link(ob):
 bpy.context.collection.objects.link(ob);return ob
def mesh_from(name,verts,faces,mat=None,smooth=True):
 me=bpy.data.meshes.new(name);me.from_pydata([tuple(v)for v in verts],[],[tuple(f)for f in faces]);me.update()
 ob=bpy.data.objects.new(name,me);link(ob)
 if mat:ob.data.materials.append(mat)
 if smooth:
  for p in me.polygons:p.use_smooth=True
 return ob
def box(name,loc,size,mat=None):
 v,f=E.box_local(size);return mesh_from(name,[ (x+loc[0],y+loc[1],z+loc[2])for(x,y,z)in v],f,mat,smooth=False)
 # NOTE: verts offset here equals ob-at-origin + location baked once at build;
 # cylinders below keep LOCAL+ob.location ownership; boxes are static trim so the
 # CPU test validates their WORLD corners via E.box_world (same generator).
def cylinder_z(name,loc,r,depth,mat=None,verts_n=20):
 v,f=E.cyl_z_local(r,depth,verts_n)
 me=bpy.data.meshes.new(name);me.from_pydata(v,[],f);me.update()
 ob=bpy.data.objects.new(name,me);link(ob);ob.location=loc
 if mat:ob.data.materials.append(mat)
 for p in me.polygons:p.use_smooth=True
 return ob
def grid_mesh(name,verts,faces,mat=None,smooth=True):return mesh_from(name,verts,faces,mat,smooth)
def quad_strip(name,quads,mat=None,smooth=False):
 verts=[];faces=[]
 for q in quads:
  b=len(verts);verts.extend(q);faces.append((b,b+1,b+2,b+3))
 return mesh_from(name,verts,faces,mat,smooth)
def tri_list(name,tris,mat=None,smooth=False):
 verts=[];faces=[]
 for t in tris:
  b=len(verts);verts.extend(t);faces.append((b,b+1,b+2))
 return mesh_from(name,verts,faces,mat,smooth)
def select_only(ob):
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
def smart_uv(ob):
 try:
  select_only(ob);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.uv.smart_project(angle_limit=66);bpy.ops.object.mode_set(mode='OBJECT')
 except Exception:pass
def assert_quad_planar(q,name):
 (ax,ay,az),(bx,by,bz),(cx,cy,cz),(dx,dy,dz)=q
 ux,uy,uz=bx-ax,by-ay,bz-az;vx,vy,vz=dx-ax,dy-ay,dz-az
 nx,ny,nz=uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx
 nl=math.sqrt(nx*nx+ny*ny+nz*nz)+1e-12;d=abs(nx*(cx-ax)+ny*(cy-ay)+nz*(cz-az))/nl
 assert d<1e-4,f'{name}: twisted pane {d:.6f}'
def principled(name,base_hex,metallic=0.0,roughness=0.5,alpha=None):
 mat=bpy.data.materials.new(name);mat.use_nodes=True
 bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 r=(base_hex>>16&255)/255.0;g=(base_hex>>8&255)/255.0;b=(base_hex&255)/255.0
 bsdf.inputs['Base Color'].default_value=(r,g,b,1.0)
 if'Metallic'in bsdf.inputs:bsdf.inputs['Metallic'].default_value=metallic
 if'Roughness'in bsdf.inputs:bsdf.inputs['Roughness'].default_value=roughness
 if alpha is not None:
  try:bsdf.inputs['Alpha'].default_value=alpha;mat.blend_method='BLEND'
  except Exception:pass
 return mat
mat_body=principled('SedanBody',BODY_HEX,metallic=0.25,roughness=0.34)
mat_cream=principled('SedanCream',CREAM_HEX,metallic=0.0,roughness=0.42)
mat_chrome=principled('SedanChrome',CHROME_HEX,metallic=1.0,roughness=0.24)
mat_glass=principled('SedanGlass',GLASS_HEX,metallic=0.0,roughness=0.10,alpha=0.65)
mat_trim=principled('SedanTrimDark',TRIM_HEX,metallic=0.15,roughness=0.85)
mat_signal=principled('SedanSignalRed',SIGNAL_HEX,metallic=0.15,roughness=0.35)
EMBEDDED_IMAGES=[]
# ---- envelope-first pre-flight: scan ACTUAL generator output before any mesh ----
hv,hf=E.loft_hull();hog,hogf=E.hood_grid();trg,trgf=E.trunk_grid();roofv,rooff=E.roof_grid()
wsg,wsgf=E.windshield_grid();rwg,rwgf=E.rear_grid();archv,archf=E.arch_lips();finv,finf=E.fins()
pre_sets=[hv,hog,trg,roofv,wsg,rwg,archv,finv]+[list(q) for q in E.side_glass_quads()]
for _n,_l,_s in E.addon_boxes()+E.lug_boxes()+E.trim_boxes():
 w,_=E.box_world(_l,_s);pre_sets.append(w)
for _n,_l,_r,_d,_nn,_rot in E.addon_cylinders():
 loc=_l
 if _rot:
  v,_=E.cyl_z_local(_r,_d,_nn);pre_sets.append([(_l[0]+p[2],_l[1]+p[1],_l[2]-p[0])for p in v])
 else:
  w,_=E.cyl_z_world(_l,_r,_d,_nn);pre_sets.append(w)
_mn,_mx,_errs=E.check_authored(pre_sets)
print(f'SEDAN_ENVELOPE_MUSE_1105 pre authored x=[{_mn[0]:.3f},{_mx[0]:.3f}] y=[{_mn[1]:.3f},{_mx[1]:.3f}] z=[{_mn[2]:.3f},{_mx[2]:.3f}]')
assert not _errs,f'SEDAN_ENVELOPE_MUSE_1105 pre-flight breach: {_errs}'
# ---- build ----
body=mesh_from('SedanBodyHull',hv,hf,mat_body,smooth=True);smart_uv(body)
hood=grid_mesh('SedanHoodCrown',hog,hogf,mat_body);smart_uv(hood)
trunk=grid_mesh('SedanTrunkCrown',trg,trgf,mat_body);smart_uv(trunk)
roof=grid_mesh('SedanRoofCrown',roofv,rooff,mat_cream);smart_uv(roof)
ws=grid_mesh('SedanWindshield',wsg,wsgf,mat_glass);rw=grid_mesh('SedanRearWindow',rwg,rwgf,mat_glass)
sq=E.side_glass_quads()
for q in sq:assert_quad_planar(q,'SedanSideGlass')
side_glass=quad_strip('SedanSideGlass',sq,mat_glass)
arches=quad_strip('SedanArchLips',[[tuple(p)for p in q]for q in[archv[i*4:(i+1)*4]for i in range(len(archv)//4)]],mat_body)
finsm=mesh_from('SedanFins',finv,finf,mat_body,smooth=False)
for n,l,s in E.addon_boxes():
 m=mat_chrome
 if'GrilleBack'in n or'Belly'in n or'MirrorArm'in n:m=mat_trim
 if'Cream'in n or'Plate'in n:m=mat_cream
 if'Bumper'in n or'Spear'in n or'Handle'in n or'Bar_'in n:m=mat_chrome
 box(n,l,s,m)
for n,l,r,d,nn,rot in E.addon_cylinders():
 m=mat_trim
 if'Dome'in n or'Bezel'in n or'Dagmar'in n or'Exhaust'in n or'MirrorHead'in n:m=mat_chrome
 if'Wall'in n:m=mat_cream
 if'Lens'in n:m=mat_glass if'Head'in n else mat_signal
 if'TailSock'in n:m=mat_chrome
 ob=cylinder_z(n,l,r,d,m,verts_n=nn)
 if rot:ob.rotation_euler=(0.0,math.pi/2,0.0)
for n,l,s in E.lug_boxes():box(n,l,s,mat_chrome)
for n,l,s in E.trim_boxes():
 m=mat_chrome
 if'Pillar' in n:m=mat_body
 box(n,l,s,m)
# ---- ownership gates on ACTUAL objects (centres survive Ry, tubs unrotated) ----
for ax in E.WHEEL_XS:
 for side in(1.0,-1.0):
  tag=f'{ax}_{"L"if side>0 else"R"}';zc=side*E.WHEEL_Z
  for kind in('Tyre','Wall','Rim','Dome'):
   ob=bpy.data.objects[f'Sedan{kind}_{tag}']
   assert _close_seq(ob.location,(ax,E.WHEEL_Y,zc),_F32_TOL_M),f'{ob.name}: off-centre'
   assert _close_seq(ob.rotation_euler,(0.0,0.0,0.0),_F32_TOL_RAD),f'{ob.name}: must stay unrotated'
  tub=bpy.data.objects[f'SedanTub_{tag}']
  assert abs(tub.rotation_euler[0])<=_F32_TOL_RAD and abs(tub.rotation_euler[1])<=_F32_TOL_RAD,f'{tub.name}: tub rotated'
for lz in E.LAMP_ZS:
 for kind,xx in(('HeadSock',2.28),('HeadBezel',2.315),('HeadLens',2.34)):
  ob=bpy.data.objects[f'Sedan{kind}_{lz}']
  assert _close_seq(tuple(ob.location)[1:],(E.LAMP_Y,lz),_F32_TOL_M),f'{ob.name}: moved after rotation'
  assert _close_seq(ob.rotation_euler,(0.0,math.pi/2,0.0),_F32_TOL_RAD),f'{ob.name}: lamp must hold (0,pi/2,0)'
# ---- roll y-up -> z-up (world-matrix premultiply ONLY) ----
from mathutils import Matrix as _Matrix
_ROLL=_Matrix.Rotation(math.pi/2,4,'X')
for _ob in[o for o in bpy.data.objects if o.type=='MESH']:_ob.matrix_world=_ROLL@_ob.matrix_world
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=body
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
import mathutils
_mn=mathutils.Vector((1e9,1e9,1e9));_mx=mathutils.Vector((-1e9,-1e9,-1e9))
for _ob in[o for o in bpy.data.objects if o.type=='MESH']:
 for _c in _ob.bound_box:
  _w=_ob.matrix_world@mathutils.Vector(_c)
  _mn.x=min(_mn.x,_w.x);_mn.y=min(_mn.y,_w.y);_mn.z=min(_mn.z,_w.z)
  _mx.x=max(_mx.x,_w.x);_mx.y=max(_mx.y,_w.y);_mx.z=max(_mx.z,_w.z)
print(f'SEDAN_ENVELOPE_MUSE_1105 bounds x=[{_mn.x:.3f},{_mx.x:.3f}] y=[{_mn.y:.3f},{_mx.y:.3f}] z=[{_mn.z:.3f},{_mx.z:.3f}]')
assert _mx.x-_mn.x<=5.04+0.02,f'length breach: {_mx.x-_mn.x}'
assert _mn.y>=-1.02-0.03 and _mx.y<=1.02+0.03,f'width breach: [{_mn.y},{_mx.y}]'
assert _mn.z>=-0.03 and _mx.z<=E.Y_MAX+0.02,f'height breach: [{_mn.z},{_mx.z}]'
tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons)for o in bpy.data.objects if o.type=='MESH')
print(f'SEDAN_ENVELOPE_MUSE_1105 tris={tris} materials={len(bpy.data.materials)} embedded=0x1024')
assert tris<=14000,f'tri budget blown: {tris}'
assert len(bpy.data.materials)<=6,f'material budget blown: {len(bpy.data.materials)}'
OUT_GLB.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT_GLB),export_format='GLB',export_apply=True,export_yup=True,export_materials='EXPORT')
wall=time.perf_counter()-T0;size_b=OUT_GLB.stat().st_size
print(f'SEDAN_ENVELOPE_MUSE_1105 time_s={wall:.1f} tris={tris} glb_bytes={size_b} path={OUT_GLB}')
