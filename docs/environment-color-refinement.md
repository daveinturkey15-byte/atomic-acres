# Environment color correction

Observed: rough metal latches and weapon/hand surfaces were nearly black in shade.
Source inspection found an extra sRGB-to-linear conversion in skyCol(). Three
0.180 already performs this conversion for hexadecimal Color inputs. Removing
the second conversion restores the authored environment radiance; light counts,
exposure, AO, sun/fill strengths and camera positions are unchanged. The linear
environment texture now declares LinearSRGBColorSpace explicitly.

Upstream: https://threejs.org/docs/pages/Color.html ; verified against installed
node_modules/three/src/math/Color.js setHex() and its ColorManagement.toWorkingColorSpace call.

Visual acceptance compares prop-round1 against color-round1 at identical stations.
This is an environment color correction, not a claim of full photorealism.
