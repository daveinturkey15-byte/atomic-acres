import json
from pathlib import Path
import tempfile
import unittest
from task_contract import ContractError, contained, verify_artifacts, validate_lineage, validate_skills, load_contract, freeze_contract, sha, git
from run_limits import RunLease


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.c=dict(before_hashes={'a':'old','b':'same'},writable_paths=['a'],outputs=['a'],
                    task_id='one-task',source_sha='head',contract_sha256='hash',tree=str(self.root),max_attempts=2,reserved_usd=.25)

    def test_scope_and_missing_output(self):
        for files in ({'a':'new','b':'changed'}, {'b':'same'}):
            with self.assertRaises(ContractError): verify_artifacts(self.c,self.root,files)
        result=verify_artifacts(self.c,self.root,{'a':'new','b':'same'})
        self.assertFalse(result['accepted']); self.assertEqual(result['changed_files'],['a'])

    def test_path_escape(self):
        for path in ('../outside','.'):
            with self.assertRaises(ContractError): contained(self.root,path)

    def test_writer_and_attempt_limits(self):
        db=self.root/'runs.sqlite'
        with RunLease(db,'1',self.c):
            with self.assertRaises(ContractError): RunLease(db,'2',self.c).__enter__()
        with RunLease(db,'3',self.c): pass
        with self.assertRaises(ContractError): RunLease(db,'4',self.c).__enter__()

    def test_uncertain_lease_not_auto_expired(self):
        db=self.root/'runs.sqlite'; lease=RunLease(db,'1',self.c); lease.__enter__()
        with self.assertRaises(ContractError): RunLease(db,'2',self.c).__enter__()
        lease.finish('interrupted')
        with RunLease(db,'3',self.c): pass

    def test_nested_writer_and_changed_contract_cannot_evade_limits(self):
        db=self.root/'runs.sqlite'
        with RunLease(db,'1',self.c):
            with self.assertRaises(ContractError):
                RunLease(db,'2',dict(self.c,tree=str(self.root/'nested'),task_id='other')).__enter__()
        with RunLease(db,'3',dict(self.c,contract_sha256='repair')): pass
        with self.assertRaises(ContractError):
            RunLease(db,'4',dict(self.c,contract_sha256='third-change')).__enter__()

    def test_nonfinite_cost_and_campaign_limit(self):
        for value in (float('nan'),float('inf'),-1,True):
            with self.assertRaises(ContractError):
                RunLease(self.root/'bad.sqlite','x',dict(self.c,reserved_usd=value)).__enter__()
        db=self.root/'money.sqlite'
        with RunLease(db,'1',dict(self.c,reserved_usd=1)): pass
        with self.assertRaises(ContractError):
            RunLease(db,'2',dict(self.c,reserved_usd=.6)).__enter__()

    def test_skill_drift_and_missing_baseline(self):
        skill=self.root/'SKILL.md'; skill.write_text('evaluated body')
        item=dict(path=str(skill),sha256=sha(skill))
        base=self.root/'baseline.json'; base.write_text(json.dumps({'skills':{'known':item}}))
        validate_skills({'known':item},base)
        with self.assertRaises(ContractError): validate_skills({'unknown':item},base)
        skill.write_text('unreviewed change')
        with self.assertRaises(ContractError): validate_skills({'known':item},base)

    def test_source_and_worker_drift_rejected_after_freeze(self):
        root=self.root/'root'; worker=self.root/'worker'
        for tree in (root,worker):
            tree.mkdir(); git(tree,'init'); git(tree,'config','user.name','Fixture'); git(tree,'config','user.email','fixture@example.invalid')
            (tree/'input.txt').write_text('current source')
            git(tree,'add','input.txt'); git(tree,'commit','-m','fixture')
        prompt=self.root/'prompt.md'; prompt.write_text('One scoped change')
        spec=dict(self.c,tree=str(worker),route='glm',max_minutes=1,billing_class='subscription',
                  objective='fixture',owner='lead',acceptance=['fixture'],writable_paths=['output.txt'],
                  outputs=['output.txt'],inputs=['input.txt'],skills={})
        contract=freeze_contract(root,spec,prompt)
        folder=root/'docs/orchestration/contracts'; folder.mkdir(parents=True)
        (folder/'fixture.json').write_text(json.dumps(contract))
        load_contract(root,'fixture','glm',worker,prompt)
        (root/'input.txt').write_text('changed root without new commit')
        with self.assertRaises(ContractError): load_contract(root,'fixture','glm',worker,prompt)
        (root/'input.txt').write_text('current source')
        (worker/'unexpected.txt').write_text('other writer')
        with self.assertRaises(ContractError): load_contract(root,'fixture','glm',worker,prompt)

    def test_concept_cannot_be_promoted_without_3d(self):
        p=self.root/'concept.png'; p.write_bytes(b'fixture')
        row=dict(id='sample',stage='reference',source_url='https://example.com/reference',
                 code_license='MIT',model_license='not applicable',output_license='owner original',
                 reference=dict(path=str(p),sha256=sha(p)))
        self.assertTrue(validate_lineage(row))
        row['stage']='verified'
        with self.assertRaises(ContractError): validate_lineage(row)

    def test_failed_or_different_build_never_accepted(self):
        p=self.root/'artifact'; p.write_bytes(b'fixture')
        item=dict(path=str(p),sha256=sha(p)); proof=self.root/'proof.json'
        row=dict(id='sample',stage='verified',source_url='https://example.com',code_license='MIT',
                 model_license='original',output_license='original',reference=item,model=item,runtime=item,build=item)
        for receipt in ({'passed':False,'build_sha256':sha(p)}, {'passed':True,'build_sha256':'other'}):
            proof.write_text(json.dumps(receipt)); row['acceptance']=dict(path=str(proof),sha256=sha(proof))
            with self.assertRaises(ContractError): validate_lineage(row)


if __name__=='__main__': unittest.main()
