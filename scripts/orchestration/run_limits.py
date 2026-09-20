"""Atomic local launcher limits; no automatic expiry of an uncertain live lease."""
import math
import json
import importlib.util
import sqlite3
from pathlib import Path
import time
from contextlib import closing
from task_contract import ContractError


def _resource_sample():
    """Reuse the machine's measured guard; importing it starts no Blender job."""
    path = Path('C:/Users/david/Desktop/stuff/akp-passport/scripts/blender/bridge.py')
    spec = importlib.util.spec_from_file_location('aa_resource_bridge', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.resources()


def admitted_parallel_limit(ledger, active_count):
    state = ledger.parent.parent / 'docs/handoff/CURRENT.json'
    if not state.exists():
        return 2  # Existing fixtures/other campaigns retain their original bound.
    try:
        policy = json.loads(state.read_text(encoding='utf-8-sig'))['dispatch_policy']
        limit = policy.get('effective_parallel_workers', 2)
        if type(limit) is not int or not 1 <= limit <= 6:
            raise ValueError('Invalid source-worker capacity')
        if limit > 2 and (policy.get('expansion_owner_authorized') is not True or
                          policy.get('external_workers') is not True):
            raise ValueError('Expanded capacity has no owner authorization')
        sample = _resource_sample()
        ram, vram = sample['free_ram_gib'], sample['free_vram_gib']
        if any(type(v) not in (float, int) or not math.isfinite(v) for v in (ram, vram)):
            raise ValueError('Unknown resource reading')
        # Conservative headroom for EVERY admitted source worker, including active
        # ones. This does not grant any parallel Blender/GPU/browser execution.
        required = 12 + 2 * (active_count + 1)
        if ram < required or vram < 3:
            raise ValueError(f'Source headroom held: need {required}GiB RAM/3GiB VRAM; '
                             f'free {ram:.2f}/{vram:.2f}')
        return limit
    except Exception as exc:
        raise ContractError('Capacity/resource admission held: ' + str(exc)) from exc


class RunLease:
    def __init__(self, path: Path, run_id: str, contract: dict):
        self.path, self.run_id, self.contract = path, run_id, contract
        self.active = False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=10)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, contract TEXT, tree TEXT, status TEXT, reserve REAL, charged REAL, started REAL)')
            db.execute('BEGIN IMMEDIATE')
            active = db.execute("SELECT tree FROM runs WHERE status='running'").fetchall()
            c = self.contract
            reserve = c.get('reserved_usd')
            if type(reserve) not in (float, int) or not math.isfinite(reserve) or not 0 < reserve <= 1:
                raise ContractError('Invalid finite reservation')
            tree = Path(c['tree']).resolve()
            limit = admitted_parallel_limit(self.path, len(active))
            if len(active) >= limit or any(tree.is_relative_to(Path(row[0]).resolve()) or
                                      Path(row[0]).resolve().is_relative_to(tree) for row in active):
                raise ContractError('Concurrency or single-writer limit reached')
            attempts = db.execute('SELECT COUNT(*) FROM runs WHERE contract=?', (c['task_id'],)).fetchone()[0]
            if attempts >= c['max_attempts']:
                raise ContractError('Attempt/repair budget exhausted')
            used = db.execute('SELECT COALESCE(SUM(COALESCE(charged,reserve)),0) FROM runs').fetchone()[0]
            # This task campaign has a fixed local admission envelope, not an account billing cap.
            if used + reserve > 1.5:
                raise ContractError('Campaign reservation budget exhausted')
            db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?)',
                       (self.run_id,c['task_id'],c['tree'],'running',c['reserved_usd'],None,time.time()))
        self.active = True
        return self

    def finish(self, status='ended', actual_cost=None):
        if not self.active:
            return
        if actual_cost is not None and (type(actual_cost) not in (int,float) or not math.isfinite(actual_cost) or actual_cost < 0):
            raise ContractError('Invalid charge')
        if status not in {'ended', 'failed', 'interrupted'}:
            raise ContractError('Invalid terminal lease status')
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('UPDATE runs SET status=?,charged=? WHERE id=?', (status,actual_cost,self.run_id))
        self.active = False

    def __exit__(self, typ, value, tb):
        self.finish('failed' if typ else 'ended')
