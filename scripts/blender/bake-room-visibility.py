"""Deterministic CPU-only ambient visibility from actual house triangles.
No Cycles/GPU job or preferences. Run through shared guarded Blender CLI.
"""
import bpy, json, math, time, hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[2]
src = root/'work/room-visibility-bake/occluders.json'
dst = root/'public/assets/room-visibility'; dst.mkdir(parents=True,exist_ok=True)
data = json.loads(src.read_text()); start=time.monotonic()
bpy.context.scene.render.threads_mode='FIXED'; bpy.context.scene.render.threads=2
bpy.context.scene.cycles.device='CPU'
bvh = BVHTree.FromPolygons([Vector(v) for v in data['positions']], data['triangles'], all_triangles=True)
nx,ny,nz=data['dimensions']; lo=data['bounds']['min']; hi=data['bounds']['max']
dirs=[]; weights=[]; sums=[0.0]*6
for i in range(data['directions']):
    y=1-2*(i+.5)/data['directions']; r=math.sqrt(1-y*y); phi=i*math.pi*(3-math.sqrt(5))
    d=Vector((r*math.cos(phi),y,r*math.sin(phi))); dirs.append(d)
    w=[max(0,d.x),max(0,d.y),max(0,d.z),max(0,-d.x),max(0,-d.y),max(0,-d.z)]
    weights.append(w)
    for j in range(6): sums[j]+=w[j]
positive=bytearray(nx*ny*nz*4); negative=bytearray(len(positive))
for z in range(nz):
    for y in range(ny):
        for x in range(nx):
            p=Vector(tuple(lo[a]+(hi[a]-lo[a])*(q+.5)/n for a,q,n in [(0,x,nx),(1,y,ny),(2,z,nz)]))
            values=[0.0]*6
            for d,w in zip(dirs,weights):
                loc,norm,index,distance=bvh.ray_cast(p,d,8.0)
                # Occluded rays retain a bounded room-fill approximation. The
                # unoccluded window/door rays carry full sky visibility.
                visibility=1.0 if loc is None else .12+.28*min(distance/3.0,1.0)
                for j in range(6): values[j]+=visibility*w[j]
            k=((z*ny+y)*nx+x)*4
            positive[k:k+4]=bytes([round(values[j]/sums[j]*255) for j in range(3)]+[255])
            negative[k:k+4]=bytes([round(values[j]/sums[j]*255) for j in range(3,6)]+[255])
    print(f'layer {z+1}/{nz} elapsed {time.monotonic()-start:.1f}s',flush=True)
files={}
for name,pixels in [('positive.bin',positive),('negative.bin',negative)]:
    (dst/name).write_bytes(pixels); files[name]={'bytes':len(pixels),'sha256':hashlib.sha256(pixels).hexdigest()}
receipt={k:data[k] for k in ['source','sourceHashes','bounds','dimensions','directions','meshes']}
receipt.update({'occluderSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'triangles':len(data['triangles']),
  'seconds':time.monotonic()-start,'blender':bpy.app.version_string,'route':'guarded CPU Blender BVH; no GPU/no rendering',
  'algorithm':'original cosine-lobe visibility with bounded distance-fill approximation; not GI',
  'files':files,'license':'original project data; no external model or asset inputs'})
(dst/'provenance.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
