import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('provider_lane', Path(__file__).with_name('run-provider-lane.py'))
lane = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lane)


class Usage(unittest.TestCase):
    def test_only_terminal_assistant_usage_is_retained_without_content(self):
        message = dict(role='assistant', provider='zai', model='glm-5.3-flash',
                       content=[{'type':'text','text':'private output'}],
                       usage={'input':10,'output':2,'totalTokens':12,'cost':{'total':.01},'extra':'private'})
        records = [lane._assistant_audit_record({'type':kind,'message':message})
                   for kind in ['message_start','message_end','turn_end']]
        self.assertNotIn('private', json.dumps(records))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'metadata.jsonl'
            path.write_text('\n'.join(json.dumps(row) for row in records))
            facts = lane._transcript_facts(path)
        self.assertEqual(len(facts['usage']), 1)
        self.assertEqual(facts['usage'][0]['cost']['total'], .01)
