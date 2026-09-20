"""No provider calls: admission failures must happen before any dispatch side effect."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from dispatch_policy import DispatchHold, require_external_dispatch


def load_launcher(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DispatchPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'docs/handoff/CURRENT.json'
        self.state.parent.mkdir(parents=True)

    def write(self, value):
        self.state.write_text(json.dumps(value), encoding='utf-8')

    def test_missing_and_malformed_state_deny(self):
        with self.assertRaises(DispatchHold):
            require_external_dispatch(self.root, 'glm')
        self.state.write_text('{bad json', encoding='utf-8')
        with self.assertRaises(DispatchHold):
            require_external_dispatch(self.root, 'glm')

    def test_ambiguous_or_disabled_policies_deny(self):
        for value in [None, [], {}, {'dispatch_policy': None},
                      {'dispatch_policy': {'schema_version': 1, 'external_workers': False, 'allowed_routes': ['glm']}},
                      {'dispatch_policy': {'schema_version': 1, 'external_workers': 'true', 'allowed_routes': ['glm']}},
                      {'dispatch_policy': {'schema_version': 2, 'external_workers': True, 'allowed_routes': ['glm']}},
                      {'dispatch_policy': {'schema_version': True, 'external_workers': True, 'allowed_routes': ['glm']}},
                      {'dispatch_policy': {'schema_version': 1, 'external_workers': True, 'allowed_routes': 'glm'}}]:
            with self.subTest(value=value):
                self.write(value)
                with self.assertRaises(DispatchHold):
                    require_external_dispatch(self.root, 'glm')

    def test_permission_is_explicit_and_route_scoped(self):
        self.write({'dispatch_policy': {'schema_version': 1, 'external_workers': True, 'allowed_routes': ['muse']}})
        require_external_dispatch(self.root, 'muse')
        for route in ['glm', 'agy', 'arbitrary']:
            with self.subTest(route=route), self.assertRaises(DispatchHold):
                require_external_dispatch(self.root, route)

    def test_omp_hold_precedes_git_ledger_and_provider(self):
        launcher = load_launcher('run-provider-lane')
        self.write({'dispatch_policy': {'external_workers': False}})
        with patch.object(launcher, 'REPO_ROOT', self.root), patch.object(launcher.subprocess, 'run') as run:
            with self.assertRaisesRegex(launcher.LaneError, 'DISPATCH HELD'):
                launcher._validate_inputs(self.root/'absent.md', self.root, 'audit', 'glm')
            run.assert_not_called()

    def test_agy_hold_precedes_ledger_and_provider(self):
        launcher = load_launcher('run-agy-overnight')
        self.write({'dispatch_policy': {'external_workers': False}})
        with patch.object(launcher, 'ROOT', self.root), patch.object(launcher.sys, 'argv', ['launcher']), \
             patch.object(launcher.subprocess, 'check_output') as ledger, \
             patch.object(launcher.subprocess, 'Popen') as provider:
            with self.assertRaisesRegex(SystemExit, 'DISPATCH HELD'):
                launcher.main()
            ledger.assert_not_called()
            provider.assert_not_called()


if __name__ == '__main__':
    unittest.main()
