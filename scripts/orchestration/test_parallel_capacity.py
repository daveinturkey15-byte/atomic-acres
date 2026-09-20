import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from run_limits import RunLease, admitted_parallel_limit
from task_contract import ContractError


class Capacity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / '.recovery-runtime/runs.sqlite'
        self.state = self.root / 'docs/handoff/CURRENT.json'
        self.state.parent.mkdir(parents=True)

    def policy(self, count=6, authorized=True):
        self.state.write_text(json.dumps({'dispatch_policy': {
            'effective_parallel_workers': count,
            'expansion_owner_authorized': authorized, 'external_workers': True}}))

    @patch('run_limits._resource_sample', return_value={'free_ram_gib': 30, 'free_vram_gib': 8})
    def test_explicit_six_writers_and_seventh_refused(self, _):
        self.policy()
        leases = []
        try:
            for i in range(6):
                c = dict(task_id=str(i), tree=str(self.root/str(i)), max_attempts=2, reserved_usd=.1)
                lease = RunLease(self.db, str(i), c)
                lease.__enter__()
                leases.append(lease)
            with self.assertRaises(ContractError):
                RunLease(self.db, '7', dict(c,task_id='7',tree=str(self.root/'7'))).__enter__()
        finally:
            for lease in leases: lease.finish()

    @patch('run_limits._resource_sample', return_value={'free_ram_gib': 30, 'free_vram_gib': 8})
    def test_bad_or_unapproved_capacity_refused(self, _):
        for n, auth in [(6,False),(7,True),(True,True),(0,True)]:
            self.policy(n,auth)
            with self.assertRaises(ContractError): admitted_parallel_limit(self.db,0)

    def test_resource_unknown_low_or_missing_holds(self):
        self.policy()
        for sample in [{'free_ram_gib':17.9,'free_vram_gib':8},
                       {'free_ram_gib':30,'free_vram_gib':2.9},
                       {'free_ram_gib':float('nan'),'free_vram_gib':8}, {}]:
            with patch('run_limits._resource_sample', return_value=sample):
                with self.assertRaises(ContractError): admitted_parallel_limit(self.db,2)

    @patch('run_limits._resource_sample', return_value={'free_ram_gib': 30, 'free_vram_gib': 8})
    def test_default_stays_two_and_authorized_overlap_still_refused(self, _):
        self.state.write_text(json.dumps({'dispatch_policy':{}}))
        self.assertEqual(admitted_parallel_limit(self.db,0),2)
        self.policy()
        c=dict(task_id='one',tree=str(self.root/'worker'),max_attempts=2,reserved_usd=.1)
        with RunLease(self.db,'one',c):
            with self.assertRaises(ContractError):
                RunLease(self.db,'two',dict(c,task_id='two',tree=str(self.root/'worker/nested'))).__enter__()


if __name__ == '__main__': unittest.main()
