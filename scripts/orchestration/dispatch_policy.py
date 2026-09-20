"""Local launcher admission only; this is not a machine-wide process sandbox."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


class DispatchHold(RuntimeError):
    pass


def require_external_dispatch(root: Path, route: str) -> None:
    try:
        state = json.loads((root / 'docs/handoff/CURRENT.json').read_text(encoding='utf-8-sig'))
        policy = state.get('dispatch_policy')
        allowed = (
            isinstance(policy, dict)
            and type(policy.get('schema_version')) is int
            and policy.get('schema_version') == 1
            and policy.get('external_workers') is True
            and isinstance(policy.get('allowed_routes'), list)
            and route in policy['allowed_routes']
            and route in {'glm', 'muse', 'agy'}
        )
    except (OSError, ValueError, AttributeError):
        allowed = False
    if not allowed:
        raise DispatchHold('EXTERNAL DISPATCH HELD: CURRENT.json does not authorize this route. '
                           'Do not change owner policy to make a launch pass.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--route', required=True, choices=['glm', 'muse', 'agy'])
    args = parser.parse_args()
    try:
        require_external_dispatch(Path(__file__).resolve().parents[2], args.route)
    except DispatchHold as exc:
        parser.exit(2, str(exc) + '\n')
