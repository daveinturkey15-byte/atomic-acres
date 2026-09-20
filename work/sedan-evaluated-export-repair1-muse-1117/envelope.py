"""Envelope-first sedan generators (CPU + Blender share SAME code)."""
import math
X_BODY=2.40;X_HARD=2.52;X_LIMIT=2.50
Z_BODY=0.975;Z_HARD=1.05;Z_DESIGN=1.02
Y_FLOOR=0.0;Y_MAX=1.48;Y_DESIGN=1.44
WHEEL_R=0.34;WHEEL_Y=0.34;WHEEL_XS=(1.52,-1.52);WHEEL_Z=0.86;TYRE_W=0.22
LAMP_Y=0.64;LAMP_ZS=(-0.78,-0.60,0.60,0.78);LAMP_R=0.105
RIBS=[(-2.40,0.32,0.50,0.70,0.74),(-2.34,0.60,0.46,0.74,0.79),(-2.20,0.82,0.42,0.78,0.84),(-1.90,0.90,0.36,0.86,0.91),(-1.52,0.94,0.34,0.90,0.93),(-1.18,0.94,0.34,0.91,0.93),(-0.30,0.94,0.34,0.91,0.92),(0.60,0.94,0.34,0.90,0.91),(1.00,0.94,0.34,0.88,0.90),(1.52,0.94,0.34,0.86,0.88),(1.95,0.90,0.36,0.82,0.84),(2.20,0.82,0.40,0.77,0.79),(2.40,0.32,0.50,0.68,0.70)]
SECTION_FLANK=[(0.00,0.00),(0.50,0.00),(0.80,0.03),(0.94,0.10),(1.00,0.25),(1.00,0.55),(0.99,0.80),(0.97,1.00)]
GX0,GX1=-1.10,0.95;GBELT,GROOF=0.92,1.36;GHALF_BELT,GHALF_ROOF=0.74,0.60
ROOF_Y=1.40;ARCH_R_OUT,ARCH_R_IN,ARCH_SEG=0.46,0.39,14;TUB_R,TUB_Y=0.36,0.48
MATERIALS=["SedanBody","SedanCream","SedanChrome","SedanGlass","SedanTrimDark","SedanSignalRed"]
def _sub(a,b):return(a[0]-b[0],a[1]-b[1],a[2]-b[2])
def _cross(a,b):return(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def _dot(a,b):return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def face_normal(v0,v1,v2):return _cross(_sub(v1,v0),_sub(v2,v0))
def tri_count(faces):return sum(len(f)-2 for f in faces)
def ry90_pt(p):
 x,y,z=p;return(z,y,-x)
def roll_x90_pt(p):
 x,y,z=p;return(x,-z,y)
def box_local(size):
 sx,sy,sz=size[0]/2.0,size[1]/2.0,size[2]/2.0
 v=[(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),(-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]
 f=[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
 return v,f
def cyl_z_local(r,depth,n=20):
 v=[]
 for i in range(n):
  a=2.0*math.pi*i/n;v.append((r*math.cos(a),r*math.sin(a),-depth/2.0))
 for i in range(n):
  a=2.0*math.pi*i/n;v.append((r*math.cos(a),r*math.sin(a),depth/2.0))
 f=[]
 for i in range(n):
  j=(i+1)%n;f.append((i,j,n+j,n+i))
 f.append(tuple(range(n-1,-1,-1)));f.append(tuple(range(n,2*n)))
 return v,f
def place(verts,loc):return[(x+loc[0],y+loc[1],z+loc[2])for(x,y,z)in verts]
def box_world(loc,size):
 v,f=box_local(size);return place(v,loc),f
def cyl_z_world(loc,r,depth,n=20):
 v,f=cyl_z_local(r,depth,n);return place(v,loc),f
def _flank_loop():
 loop=list(SECTION_FLANK)
 for i in range(len(SECTION_FLANK)-2,0,-1):loop.append((-SECTION_FLANK[i][0],SECTION_FLANK[i][1]))
 return loop
def loft_hull():
 loop=_flank_loop();rings=[];verts=[]
 for(rx,hw,skirt,belt,_crown)in RIBS:
  ring=[]
  for(u,vfrac)in loop:
   verts.append((rx,skirt+vfrac*(belt-skirt),u*hw));ring.append(len(verts)-1)
  rings.append(ring)
 faces=[];nl=len(loop)
 for ri in range(len(rings)-1):
  for k in range(nl):
   k2=(k+1)%nl;faces.append((rings[ri][k],rings[ri+1][k],rings[ri+1][k2],rings[ri][k2]))
 for end in(0,len(rings)-1):
  apex=len(verts);rx,_hw,skirt,belt,_c=RIBS[end]
  verts.append((rx,(skirt+belt)*0.5,0.0));ring=rings[end]
  for k in range(nl):
   k2=(k+1)%nl
   faces.append((apex,ring[k],ring[k2])if end==0 else(apex,ring[k2],ring[k]))
 return verts,faces
def _crown_grid(xs,zs,y_fn):
 grid=[];verts=[]
 for x in xs:
  row=[]
  for z in zs:verts.append((x,y_fn(x,z),z));row.append(len(verts)-1)
  grid.append(row)
 faces=[]
 for i in range(len(xs)-1):
  for j in range(len(zs)-1):faces.append((grid[i][j],grid[i+1][j],grid[i+1][j+1],grid[i][j+1]))
 return verts,faces
def hood_grid():
 xs=[1.00,1.30,1.60,1.90,2.15,2.32];zs=[-0.80,-0.55,-0.28,0.0,0.28,0.55,0.80]
 def y(x,z):
  t=(x-1.00)/(2.32-1.00);return(0.90-0.10*t)+0.035*(1.0-(z/0.85)**2)
 return _crown_grid(xs,zs,y)
def trunk_grid():
 xs=[-1.18,-1.45,-1.75,-2.05,-2.25,-2.34];zs=[-0.78,-0.52,-0.26,0.0,0.26,0.52,0.78]
 def y(x,z):
  t=(-1.18-x)/(-1.18+2.34);return(0.93-0.09*t)+0.030*(1.0-(z/0.83)**2)
 return _crown_grid(xs,zs,y)
def roof_grid():
 xs=[-1.16,-0.95,-0.60,-0.25,0.05,0.32,0.55];zs=[-0.62,-0.40,-0.18,0.0,0.18,0.40,0.62]
 def y(x,z):
  crown=0.045*(1.0-(z/0.68)**2);ends=0.0
  if x<-0.95:ends=-0.035*((-0.95-x)/0.21)
  if x>0.32:ends=-0.035*((x-0.32)/0.23)
  return ROOF_Y+crown+ends
 return _crown_grid(xs,zs,y)
def windshield_grid():
 xs=[0.95,0.80,0.62,0.42,0.20];rows=[GBELT,(GBELT+GROOF)*0.5,GROOF]
 verts=[];grid=[]
 for y in rows:
  row=[];f=(y-GBELT)/(GROOF-GBELT);half=GHALF_BELT+f*(GHALF_ROOF-GHALF_BELT)
  for x in xs:
   zc=half*(x/0.95);verts.append((x+0.06*f,y,zc));row.append(len(verts)-1)
  grid.append(row)
 faces=[]
 for i in range(len(rows)-1):
  for j in range(len(xs)-1):faces.append((grid[i][j],grid[i][j+1],grid[i+1][j+1],grid[i+1][j]))
 return verts,faces
def rear_grid():
 xs=[-1.10,-0.95,-0.78,-0.60,-0.42];rows=[GBELT,(GBELT+GROOF)*0.5,GROOF]
 verts=[];grid=[]
 for y in rows:
  row=[];f=(y-GBELT)/(GROOF-GBELT);half=GHALF_BELT+f*(GHALF_ROOF-GHALF_BELT)
  for x in xs:
   zc=half*((x+0.76)/0.68);zc=max(-half,min(half,zc));verts.append((x-0.06*f,y,zc));row.append(len(verts)-1)
  grid.append(row)
 faces=[]
 for i in range(len(rows)-1):
  for j in range(len(xs)-1):faces.append((grid[i][j],grid[i+1][j],grid[i+1][j+1],grid[i][j]))
 return verts,faces
def arch_lips():
 quads=[]
 for ax in WHEEL_XS:
  for side in(1.0,-1.0):
   z=side*0.95
   for si in range(ARCH_SEG):
    a0=math.pi*(0.08+0.84*si/ARCH_SEG);a1=math.pi*(0.08+0.84*(si+1)/ARCH_SEG)
    p0o=(ax+ARCH_R_OUT*math.cos(a0),WHEEL_Y+ARCH_R_OUT*math.sin(a0),z)
    p1o=(ax+ARCH_R_OUT*math.cos(a1),WHEEL_Y+ARCH_R_OUT*math.sin(a1),z)
    p1i=(ax+ARCH_R_IN*math.cos(a1),WHEEL_Y+ARCH_R_IN*math.sin(a1),z)
    p0i=(ax+ARCH_R_IN*math.cos(a0),WHEEL_Y+ARCH_R_IN*math.sin(a0),z)
    q=[p0o,p1o,p1i,p0i]
    if side<0:q=[q[0],q[3],q[2],q[1]]
    quads.append(q)
 verts=[];faces=[]
 for q in quads:
  base=len(verts);verts.extend(q);faces.append((base,base+1,base+2,base+3))
 return verts,faces
def fins():
 quads=[];tris=[]
 for side in(1.0,-1.0):
  z=side*0.86;zo=side*0.90
  q=[(-1.20,0.86,z),(-2.30,0.88,z),(-2.38,1.00,zo),(-1.35,0.96,zo)]
  if side<0:q=[q[0],q[3],q[2],q[1]]
  quads.append(q);tris.append([(-2.38,1.00,zo),(-2.40,0.94,z),(-2.40,1.00,z)])
 verts=[];faces=[]
 for q in quads:
  base=len(verts);verts.extend(q);faces.append((base,base+1,base+2,base+3))
 for t in tris:
  base=len(verts);verts.extend(t);faces.append((base,base+1,base+2))
 return verts,faces
def addon_boxes():
 B=[("SedanBumperF",(2.42,0.44,0.0),(0.16,0.16,1.70)),("SedanBumperR",(-2.42,0.46,0.0),(0.16,0.16,1.70)),("SedanGrilleBack",(2.40,0.62,0.0),(0.05,0.22,1.06))]
 for i,gy in enumerate((0.55,0.60,0.65,0.70)):B.append((f"SedanGrilleBar_{i}",(2.43,gy,0.0),(0.03,0.025,1.02)))
 B.append(("SedanPlateF",(2.480,0.44,0.0),(0.04,0.15,0.38)));B.append(("SedanPlateR",(-2.480,0.46,0.0),(0.04,0.15,0.38)))
 for side in(1.0,-1.0):
  s="L"if side>0 else"R"
  B.append((f"SedanSpearUpper_{s}",(0.10,0.74,side*0.950),(3.60,0.045,0.024)))
  B.append((f"SedanSpearLower_{s}",(0.00,0.62,side*0.950),(3.15,0.035,0.024)))
  B.append((f"SedanFlankCream_{s}",(0.05,0.68,side*0.948),(3.35,0.080,0.018)))
  for hx in(0.35,-0.45):B.append((f"SedanHandle_{s}_{hx}",(hx,0.78,side*0.960),(0.16,0.035,0.032)))
  B.append((f"SedanMirrorArm_{s}",(0.95,0.98,side*0.950),(0.04,0.04,0.080)))
  B.append((f"SedanBellyHalf_{s}",(0.0,0.32,side*0.40),(3.40,0.08,0.75)))
 B.append(("SedanBellyMid",(0.0,0.32,0.0),(3.40,0.08,0.10)))
 return B
def addon_cylinders():
 C=[]
 for ax in WHEEL_XS:
  for side in(1.0,-1.0):
   tag=f"{ax}_{'L'if side>0 else'R'}";zc=side*WHEEL_Z
   C.append((f"SedanTyre_{tag}",(ax,WHEEL_Y,zc),0.34,0.22,28,False))
   C.append((f"SedanWall_{tag}",(ax,WHEEL_Y,zc),0.22,0.226,24,False))
   C.append((f"SedanRim_{tag}",(ax,WHEEL_Y,zc),0.14,0.235,20,False))
   C.append((f"SedanDome_{tag}",(ax,WHEEL_Y,zc),0.08,0.255,16,False))
   C.append((f"SedanTub_{tag}",(ax,TUB_Y,side*(WHEEL_Z-0.16)),TUB_R,0.04,20,False))
 for lz in LAMP_ZS:
  C.append((f"SedanHeadSock_{lz}",(2.28,LAMP_Y,lz),0.110,0.08,16,True))
  C.append((f"SedanHeadBezel_{lz}",(2.315,LAMP_Y,lz),0.115,0.04,16,True))
  C.append((f"SedanHeadLens_{lz}",(2.340,LAMP_Y,lz),0.100,0.05,16,True))
 for side in(1.0,-1.0):
  C.append((f"SedanDagmarF_{side}",(2.44,0.44,side*0.36),0.070,0.12,16,True))
  C.append((f"SedanExhaust_{side}",(-2.44,0.32,side*0.52),0.036,0.10,14,True))
  C.append((f"SedanTailSock_{side}",(-2.38,1.00,side*0.885),0.090,0.08,16,True))
  C.append((f"SedanTailLens_{side}",(-2.435,1.00,side*0.885),0.075,0.05,16,True))
  C.append((f"SedanMirrorHead_{side}",(0.95,1.03,side*0.970),0.050,0.030,16,True))
 return C
def lug_boxes():
 B=[]
 for ax in WHEEL_XS:
  for side in(1.0,-1.0):
   tag=f"{ax}_{'L'if side>0 else'R'}";zc=side*(WHEEL_Z+0.10)
   for li in range(5):
    a=2.0*math.pi*li/5;lx=ax+0.10*math.cos(a);ly=WHEEL_Y+0.10*math.sin(a)
    B.append((f"SedanLug_{tag}_{li}",(lx,ly,zc),(0.034,0.034,0.034)))
 return B
def bounds_of(point_sets):
 mn=[1e9,1e9,1e9];mx=[-1e9,-1e9,-1e9]
 for pts in point_sets:
  for(x,y,z)in pts:
   mn[0]=min(mn[0],x);mn[1]=min(mn[1],y);mn[2]=min(mn[2],z)
   mx[0]=max(mx[0],x);mx[1]=max(mx[1],y);mx[2]=max(mx[2],z)
 return tuple(mn),tuple(mx)
def check_authored(point_sets):
 mn,mx=bounds_of(point_sets);errs=[]
 if not(mn[0]>=-X_HARD-1e-9 and mx[0]<=X_HARD+1e-9):errs.append(f"x {mn[0]:.4f}..{mx[0]:.4f} breaches +-X_HARD {X_HARD}")
 if not(mx[0]-mn[0]<=5.04+0.02+1e-9):errs.append(f"length {mx[0]-mn[0]:.4f} breaches 5.04+0.02")
 if not(mn[2]>=-Z_HARD-1e-9 and mx[2]<=Z_HARD+1e-9):errs.append(f"width z {mn[2]:.4f}..{mx[2]:.4f} breaches +-{Z_HARD}")
 if not(mn[1]>=Y_FLOOR-0.03-1e-9 and mx[1]<=Y_MAX+0.02+1e-9):errs.append(f"height y {mn[1]:.4f}..{mx[1]:.4f} breaches floor/{Y_MAX}")
 if not(mn[0]>=-X_LIMIT-1e-9 and mx[0]<=X_LIMIT+1e-9):errs.append(f"x {mn[0]:.4f}..{mx[0]:.4f} outside design +-X_LIMIT {X_LIMIT}")
 if not(mn[2]>=-Z_DESIGN-1e-9 and mx[2]<=Z_DESIGN+1e-9):errs.append(f"width z {mn[2]:.4f}..{mx[2]:.4f} outside design +-Z_DESIGN {Z_DESIGN}")
 return mn,mx,errs
def check_normals(verts,faces,label):
 errs=[]
 for f in faces:
  if len(f)<3:errs.append(f"{label}: degenerate {f}");continue
  n=face_normal(verts[f[0]],verts[f[1]],verts[f[2]])
  if _dot(n,n)<1e-12:errs.append(f"{label}: zero-area {f}")
 return errs
def check_box_outward(loc,size,label):
 verts,faces=box_world(loc,size);c=loc;bad=0
 for f in faces:
  n=face_normal(verts[f[0]],verts[f[1]],verts[f[2]])
  ctr=tuple(sum(verts[i][k]for i in f)/len(f)for k in range(3))
  if _dot(n,(ctr[0]-c[0],ctr[1]-c[1],ctr[2]-c[2]))<=0:bad+=1
 return[]if bad==0 else[f"{label}: {bad}/6 inward"]
def side_glass_quads():
 Q=[]
 for side in(1.0,-1.0):
  Q.append([(GX0,GBELT,side*GHALF_BELT),(GX1,GBELT,side*GHALF_BELT),(GX1-0.35,GROOF,side*GHALF_ROOF),(GX0,GROOF,side*GHALF_ROOF)])
 return Q
def trim_boxes():
 B=[]
 for side in(1.0,-1.0):
  s="L"if side>0 else"R"
  B.append((f"SedanFinSpear_{s}",(-1.85,1.02,side*0.90),(0.90,0.030,0.035)))
  B.append((f"SedanBeltRail_{s}",(-0.07,0.905,side*0.755),(2.05,0.045,0.020)))
  B.append((f"SedanDripRail_{s}",(-0.27,1.345,side*0.640),(1.85,0.040,0.020)))
  B.append((f"SedanPillarA_{s}",(0.72,1.14,side*0.700),(0.07,0.50,0.05)))
  B.append((f"SedanPillarC_{s}",(-1.02,1.14,side*0.680),(0.09,0.50,0.05)))
 return B
