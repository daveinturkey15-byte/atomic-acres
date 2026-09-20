"""CPU-only mesh construction from the exact recipe. No mocked Blender render claim."""
import ast
import collections
import hashlib
import json
import math
from pathlib import Path
from types import SimpleNamespace
from coach_geometry import repair_meshes

HERE = Path(__file__).resolve().parent
source = (HERE/'build_coach_geometry_0824.py').read_text(encoding='utf8')
tree = ast.parse(source)
constants = {}
for node in tree.body:
    if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ('RIBS','SECTION'):
        constants[node.targets[0].id] = ast.literal_eval(node.value)
hull, parts = repair_meshes(constants['RIBS'],constants['SECTION'])
mesh_objects=[]
def mesh_from(name,verts,faces,mat=None,smooth=True):
    obj=SimpleNamespace(name=name,vertices=list(verts),faces=list(faces),material=mat,
                        location=(0,0,0),rotation_euler=(0,0,0))
    mesh_objects.append(obj); return obj
env=dict(constants,math=math,mesh_from=mesh_from,smart_uv=lambda o:None,
         REPAIR_HULL=hull,REPAIR_PARTS=parts)
env.update(MID=constants['RIBS'][4],NOSE=constants['RIBS'][-1])
for role,names in {'body':['mat_body'],'chrome':['mat_chrome'],'glass':['mat_glass','mat_lens'],
    'dark':['mat_trimdark','mat_rubber','mat_dark','mat_blind'],
    'ivory':['mat_ivory','mat_whitewall'],'signal':['mat_signal','mat_maroon','mat_taillens']}.items():
    for name in names: env[name]=role
for node in tree.body:
    if isinstance(node,ast.FunctionDef) and node.name in ('roof_pull','skirt_pull','rib_point','flank_half','nose_x','box','cylinder_z','quad_strip'):
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<recipe helpers>','exec'),env)
start=source.index('# ------------------------------------------------------------------ body hull loft')
end=source.index('# Check the complete world-space asset BEFORE')
exec(compile(source[start:end],'<exact recipe geometry>','exec'),env)

def check_envelope(objects):
    bounds=[[math.inf]*3,[-math.inf]*3]
    for obj in objects:
        assert obj.rotation_euler == (0,0,0), f'Unexpected object-origin rotation: {obj.name}'
        for p in obj.vertices:
            point=[p[i]+obj.location[i] for i in range(3)]
            assert all(math.isfinite(v) for v in point)
            assert all((-5.8,0,-1.435)[i]-1e-6 <= point[i] <= (5.8,3.4,1.435)[i]+1e-6 for i in range(3)), (obj.name,point)
            for i in range(3): bounds[0][i]=min(bounds[0][i],point[i]); bounds[1][i]=max(bounds[1][i],point[i])
    return bounds
bounds=check_envelope(mesh_objects)
triangles=sum(sum(len(f)-2 for f in obj.faces) for obj in mesh_objects)
assert triangles <= 12000,triangles
assert len(set(obj.material for obj in mesh_objects)) == 6
byname={p['name']:p for p in parts}
left,right=byname['CoachScreenL'],byname['CoachScreenR']
assert len(left['vertices']) == len(right['vertices'])
for a,b in zip(left['vertices'],right['vertices']):
    assert a[2] > .08 and b[2] < -.08
    assert max(abs(a[1]-b[1]),abs(a[2]+b[2])) < 1e-9
    # The preserved loft's triangle diagonals differ across the mirror plane by
    # up to 3.64 mm. Match each REAL surface instead of forcing coplanar panes.
    assert abs((a[0]-b[0])-(hull.surface(a[1],a[2])-hull.surface(b[1],b[2]))) < 1e-9

def check_surfaces(meshes):
    for p in meshes:
        if 'surface' not in p: continue
        side=1 if p['surface']=='front' else -1
        for x,y,z in p['vertices']:
            assert abs((x-hull.surface(y,z,0,side))*side-p['offset']) < 1e-8, p['name']
check_surfaces(parts)
minimum_pane_clearance=1
for p in (left,right):
    for f in p['faces']:
        x,y,z=[sum(p['vertices'][i][a] for i in f)/3 for a in range(3)]
        clearance=x-hull.surface(y,z)
        minimum_pane_clearance=min(minimum_pane_clearance,clearance)
        assert clearance > .004, (p['name'],clearance)
for p in parts:
    if not p['name'].startswith('CoachArch_'): continue
    edges=collections.Counter()
    adjacency=collections.defaultdict(set)
    for f in p['faces']:
        for a,b in zip(f,f[1:]+f[:1]):
            edges[tuple(sorted((a,b)))]+=1; adjacency[a].add(b); adjacency[b].add(a)
    assert set(edges.values()) == {2}, (p['name'],'open/disconnected arch seam')
    reached={0}; todo=[0]
    while todo:
        for other in adjacency[todo.pop()]-reached: reached.add(other);todo.append(other)
    assert len(reached)==len(p['vertices'])

# Real falsifiers: fail when glass leaves its prescribed hull offset or a mesh
# moves outside the unchanged collider envelope; do not regenerate thresholds.
bad=dict(left,vertices=list(left['vertices'])); v=bad['vertices'][0]; bad['vertices'][0]=(v[0]+.2,v[1],v[2])
try: check_surfaces([bad]); raise RuntimeError('surface negative control was not rejected')
except AssertionError: pass
bad_obj=SimpleNamespace(name='escaped',vertices=[(5.95,1,0)],location=(0,0,0),rotation_euler=(0,0,0))
try: check_envelope([bad_obj]); raise RuntimeError('envelope negative control was not rejected')
except AssertionError: pass

report=dict(status='CPU_GEOMETRY_PASS_BLENDER_AND_GPU_OPEN', meshes=len(mesh_objects), triangles=triangles,
    materials=6, bounds=bounds, colliderEnvelope=[[-5.8,0,-1.435],[5.8,3.4,1.435]],
    paneMinimumCentroidClearance=minimum_pane_clearance,
    frontPanels='mirrored separated panes; exact hull offsets; no front-plane origin rotations',
    arches='6 closed connected annular strips, every edge used by two faces',
    negativeControls=['escaped glass offset rejected','escaped envelope vertex rejected'],
    sourceRecipeSHA256=hashlib.sha256(source.encode()).hexdigest(),
    actualBake='OPEN root bounded Blender bake, 3x1K embedded texture/material check, consolidation and actual pixels')
(HERE/'geometry-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,indent=2))
