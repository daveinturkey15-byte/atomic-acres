import importlib.util,pathlib,collections,json,math
fp=pathlib.Path(r'C:/Users/david/Desktop/stuff/worktrees/nuketown-animation-polish-20260919/work/operator-closed-surface-agy-1000/build_operator_sand_closed_surface.py')
s=importlib.util.spec_from_file_location('candidate',fp);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);out={}
for label,fn in [('shirt',m.build_closed_shirt),('trousers',m.build_closed_trousers)]:
 p=m.Part();fn(p);keys={};ids=[];pos=[]
 for i,v in enumerate(p.verts):
  key=tuple(round(x,6)for x in v)+tuple(sorted((b,round(w,6))for b,w in p.weights[i]if w>0))
  if key not in keys:keys[key]=len(pos);pos.append(v)
  ids.append(keys[key])
 edges=collections.Counter();zero=0
 for f in p.faces:
  for j in range(1,len(f)-1):
   tri=[ids[k]for k in(f[0],f[j],f[j+1])];a,b,c=[pos[k]for k in tri];u=[b[k]-a[k]for k in range(3)];v=[c[k]-a[k]for k in range(3)];cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
   if sum(x*x for x in cross)<1e-20:zero+=1;continue
   for x,y in zip(tri,tri[1:]+tri[:1]):edges[tuple(sorted((x,y)))]+=1
 boundary=[e for e,n in edges.items()if n==1];shoulder=[e for e in boundary if any(abs(pos[k][0])>.095 and 1.10<pos[k][1]<1.5 for k in e)]
 out[label]={'welded_positions_same_weights':len(pos),'zero_area_triangles':zero,'boundary':len(boundary),'nonmanifold':sum(n>2 for n in edges.values()),'open_shoulder':len(shoulder),'shoulder_examples':[[pos[k]for k in e]for e in shoulder[:8]]}
print(json.dumps(out,indent=2))
