import copy
from pathlib import Path
import tempfile
import unittest
from jev_router import advise, parse_answer, MODEL

STATE = dict(task_kind='bounded-code', permission='bounded-probe', eligible_routes=['glm', 'lead'],
             budget_available=True, source_bound=True, acceptance_defined=True)
REPLY = dict(model=MODEL, provider='TypeSafe',
             answers={'route': {'type': 'choice', 'choice': 'glm'},
                      'claim_support': {'type': 'choice', 'choice': 'insufficient'}}, usage={'cost': .00002, 'input_tokens': 100})


class JevTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = Path(self.temp.name)/'calls.sqlite'

    def test_hard_policy_never_calls_provider(self):
        for changes, expected in [({'permission': 'held'}, 'hold'), ({'permission': 'single-lead'}, 'lead'),
                                  ({'budget_available': False}, 'hold'), ({'source_bound': False}, 'hold')]:
            result = advise(dict(STATE, **changes), self.db, lambda _: self.fail('Network called'))
            self.assertEqual(result['route'], expected)
            self.assertFalse(result['network_called'])

    def test_success_then_exact_cache(self):
        self.assertEqual(advise(STATE, self.db, lambda _: REPLY)['source'], 'jev')
        self.assertEqual(advise(STATE, self.db, lambda _: self.fail('Duplicate call'))['source'], 'cache')

    def test_missing_cost_or_identity_and_ineligible_route_fail(self):
        for key, value in [('model', 'other'), ('usage', {}), ('answers', {'route': {'type': 'choice', 'choice': 'agy'}})]:
            reply = copy.deepcopy(REPLY); reply[key] = value
            with self.assertRaises(ValueError):
                parse_answer(reply, STATE)

    def test_nonfinite_cost_is_not_accepted(self):
        for cost in (float('nan'), float('inf'), -1, True):
            with self.assertRaises(ValueError):
                parse_answer(dict(REPLY, usage={'cost': cost}), STATE)

    def test_network_failure_preserves_unknown_charge_and_no_retry(self):
        def fail(_): raise TimeoutError('secret-like exception must not be retained')
        result = advise(STATE, self.db, fail)
        self.assertEqual(result['route'], 'hold')
        self.assertNotIn('secret-like', str(result))
        self.assertFalse(advise(STATE, self.db, lambda _: self.fail('Retry'))['network_called'])

    def test_bad_schema_rejected_before_storage(self):
        with self.assertRaises(ValueError): advise(dict(STATE, transcript='private'), self.db)
        self.assertFalse(self.db.exists())

    def test_call_budget_is_enforced(self):
        for i in range(20): advise(dict(STATE, task_kind=str(i)), self.db, lambda _: REPLY)
        self.assertEqual(advise(dict(STATE, task_kind='21'), self.db, lambda _: self.fail('Budget'))['source'], 'local-call-budget')


if __name__ == '__main__': unittest.main()
