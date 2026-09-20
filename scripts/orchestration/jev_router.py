"""Project adapter to the single shared AKP Jev implementation."""
from pathlib import Path
import runpy
import sys

SHARED = Path(r'C:\Users\david\Desktop\stuff\akp-passport\scripts\pipeline\jev_router.py')
if __name__ == '__main__':
    sys.argv += ['--project-root', str(Path(__file__).resolve().parents[2])]
    runpy.run_path(str(SHARED), run_name='__main__')
else:
    _shared = runpy.run_path(str(SHARED))
    MODEL, advise, parse_answer = (_shared[k] for k in ('MODEL', 'advise', 'parse_answer'))
