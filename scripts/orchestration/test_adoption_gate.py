import unittest
from adoption_gate import require_clean_row
from task_contract import ContractError


class Adoption(unittest.TestCase):
    def test_check_alone_and_stale_native_receipt_rejected(self):
        check = 'PASS: OMP on dave-gaming-pc trust=trusted'
        for audit in ('', 'FAIL: expired receipt: OMP on dave-gaming-pc\ncontrol_digest=x',
                      'AMBER: missing receipt: OMP on dave-gaming-pc\ncontrol_digest=x'):
            with self.assertRaises(ContractError): require_clean_row('OMP', check, audit)

    def test_unrelated_failure_does_not_borrow_or_block_native_row(self):
        require_clean_row('OMP', 'PASS: OMP on dave-gaming-pc trust=trusted',
                          'FAIL: expired receipt: Hermes on dave-gaming-pc\ncontrol_digest=x')
        with self.assertRaises(ContractError):
            require_clean_row('Antigravity', 'PASS: OMP on dave-gaming-pc trust=trusted', 'control_digest=x')
