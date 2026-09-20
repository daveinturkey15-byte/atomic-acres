"""Pure CPU repair meshes in the coach's single x-long/y-up/z-wide frame.
Original asset repair; samples the exact triangular hull rather than a centreline.
No bpy, renderer, image generation or external dependencies.
"""
import math
from functools import lru_cache


class Hull:
    def __init__(self, ribs, section):
        self.vertices, self.faces = [], []
        loop = list(section) + [(-u, v) for u, v in section[-2:0:-1]]
        def point(r, u, v):
            roof = max(0, (v - .4) / .6) ** 1.45
            skirt = max(0, (.3 - v) / .3) ** 1.30
            return (r[0] + (r[1]-r[0])*roof + (r[2]-r[0])*skirt,
                    r[4] + (r[5]-r[4])*v, r[3]*u)
        n = len(loop)
        for r in ribs:
            self.vertices.extend(point(r, u, v) for u, v in loop)
        for i in range(len(ribs)-1):
            for k in range(n):
                a, b, c, d = i*n+k, (i+1)*n+k, (i+1)*n+(k+1)%n, i*n+(k+1)%n
                self.faces.extend([(a,b,c), (a,c,d)])
        for end in (0, len(ribs)-1):
            apex = len(self.vertices); self.vertices.append(point(ribs[end], 0, .5))
            for k in range(n):
                self.faces.append((apex, end*n+k, end*n+(k+1)%n))

    @lru_cache(maxsize=20000)
    def surface(self, a, b, axis=0, side=1):
        """Ray/triangle intersection in the two coordinates orthogonal to axis."""
        ij = (1, 2) if axis == 0 else (0, 1)
        hits = []
        for face in self.faces:
            p, q, r = (self.vertices[i] for i in face)
            x0,y0 = p[ij[0]],p[ij[1]]; x1,y1 = q[ij[0]],q[ij[1]]; x2,y2 = r[ij[0]],r[ij[1]]
            den = (y1-y2)*(x0-x2)+(x2-x1)*(y0-y2)
            if abs(den) < 1e-12: continue
            u = ((y1-y2)*(a-x2)+(x2-x1)*(b-y2))/den
            v = ((y2-y0)*(a-x2)+(x0-x2)*(b-y2))/den
            w = 1-u-v
            if min(u,v,w) >= -1e-8:
                hits.append(u*p[axis]+v*q[axis]+w*r[axis])
        if not hits: raise ValueError(f'No hull surface at {(a,b,axis,side)}')
        return max(hits) if side > 0 else min(hits)


def repair_meshes(ribs, section):
    hull = Hull(ribs, section)
    parts = []
    def emit(name, vertices, faces, material, surface=None, offset=None):
        item = dict(name=name, vertices=vertices, faces=faces, material=material)
        if surface is not None: item.update(surface=surface, offset=offset)
        parts.append(item); return item

    def panel(name, y0,y1,z0,z1,offset,material, nu=12,nv=4, taper=1, side=1):
        vertices=[]; faces=[]
        for j in range(nv+1):
            t=j/nv; y=y0+(y1-y0)*t
            for i in range(nu+1):
                z=(z0+(z1-z0)*i/nu)*(1+(taper-1)*t)
                vertices.append((hull.surface(y,z,0,side)+side*offset,y,z))
        for j in range(nv):
            for i in range(nu):
                a=j*(nu+1)+i; b=a+1; c=a+nu+1; d=c+1
                faces.extend([(a,c,b),(b,c,d)] if (z1-z0)*side > 0 else [(a,b,c),(b,d,c)])
        return emit(name,vertices,faces,material,'front' if side>0 else 'rear',offset)

    # Matched mirrored panes, dark substrate and surface-following gasket ribbons.
    # Centre gap is never crossed; every vertex gets its own exact nose X.
    for sign,tag in ((1,'L'),(-1,'R')):
        panel('CoachScreenBed'+tag,1.875,2.65,sign*.055,sign*1.035,.018,'dark',16,8,.92)
        panel('CoachScreen'+tag,1.915,2.605,sign*.095,sign*.985,.030,'glass',16,8,.92)
        panel('CoachScreenGasketT'+tag,2.605,2.65,sign*.055*.92,sign*1.035*.92,.040,'dark',16,1)
        panel('CoachScreenGasketB'+tag,1.875,1.915,sign*.055,sign*1.035,.040,'dark',16,1)
        panel('CoachScreenGasketO'+tag,1.89,2.63,sign*.985,sign*1.035,.040,'dark',1,8,.92)
        panel('CoachScreenGasketI'+tag,1.89,2.63,sign*.055,sign*.095,.040,'dark',1,8,.92)
    panel('CoachScreenDivider',1.86,2.66,-.043,.043,.043,'chrome',2,8)
    panel('CoachBlindRim',2.715,2.90,-.58,.58,.027,'chrome',16,3,.93)
    panel('CoachBlind',2.745,2.87,-.54,.54,.037,'dark',16,3,.93)

    # Grille and bumpers follow plan curvature too; never a broad plate floating
    # on a single centreline X value. Existing material identities are unchanged.
    panel('CoachGrille',.94,1.48,-.73,.73,.020,'dark',16,4)
    for i,y in enumerate((.98,1.08,1.18,1.28,1.38)):
        panel('CoachGrilleBar'+str(i),y,y+.035,-.71,.71,.040,'chrome',16,1)
    panel('CoachBumperF',.86,1.0,-1.09,1.09,.058,'chrome',24,1)
    panel('CoachBumperR',.86,1.0,-1.09,1.09,.048,'chrome',24,1,side=-1)

    def circle(name,yc,zc,inner,outer,offset,material,side=1,n=24):
        def point(r,a):
            y=yc+r*math.cos(a); z=zc+r*math.sin(a)
            return (hull.surface(y,z,0,side)+side*offset,y,z)
        if inner == 0:
            vertices=[point(0,0)]+[point(outer,2*math.pi*i/n) for i in range(n)]
            faces=[(0,1+i,1+(i+1)%n) for i in range(n)]
        else:
            vertices=[point(r,2*math.pi*i/n) for r in (inner,outer) for i in range(n)]
            faces=[]
            for i in range(n):
                j=(i+1)%n; faces.extend([(i,n+i,n+j),(i,n+j,j)])
        if side < 0: faces=[tuple(reversed(f)) for f in faces]
        return emit(name,vertices,faces,material,'front' if side>0 else 'rear',offset)
    for i,z in enumerate((-.96,.96)):
        circle('CoachHeadSocket'+str(i),1.38,z,0,.19,.015,'dark')
        circle('CoachHeadBezel'+str(i),1.38,z,.145,.18,.040,'chrome')
        circle('CoachHeadLens'+str(i),1.38,z,0,.144,.043,'glass')
    for i,z in enumerate((-.85,-.45,.45,.85)):
        circle('CoachTailSocket'+str(i),1.55,z,0,.11,.018,'dark',-1,16)
        circle('CoachTailLens'+str(i),1.55,z,0,.086,.030,'signal',-1,16)

    # Closed connected arch ribbons, front surface following actual tumblehome.
    for ai,ax in enumerate((3.70,-2.40,-3.60)):
        for side,tag in ((1,'L'),(-1,'R')):
            vertices=[]; faces=[]; count=17
            for offset in (-.008,.018):
                for radius in (.556,.622):
                    for i in range(count):
                        a=.13+(math.pi-.26)*i/(count-1)
                        x=ax+radius*math.cos(a); y=.52+radius*math.sin(a)
                        z=hull.surface(x,y,2,side)+side*offset
                        vertices.append((x,y,z))
            for i in range(count-1):
                for a,b,c,d in ((34+i,51+i,52+i,35+i),(i,i+1,18+i,17+i),
                                (i,34+i,35+i,i+1),(17+i,18+i,52+i,51+i)):
                    faces.extend([(a,b,c),(a,c,d)])
            faces.extend([(0,17,51),(0,51,34),(16,50,67),(16,67,33)])
            if side < 0: faces=[tuple(reversed(f)) for f in faces]
            emit(f'CoachArch_{ai}_{tag}',vertices,faces,'dark')
    return hull, parts
