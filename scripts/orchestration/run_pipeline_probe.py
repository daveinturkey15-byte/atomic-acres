"""Recorded synthetic probes only. No game dispatch and no credentials on argv."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from run_limits import RunLease

ROOT = Path(__file__).resolve().parents[2]
LEDGER = Path(r'C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py')
OMP = Path(r'C:\Users\david\AppData\Roaming\npm\omp.exe')
AGY = Path(r'C:\Users\david\AppData\Local\agy\bin\agy.exe')
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
ROUTES = {'glm': ('zai/glm-5.3-flash','max','zai'),
          'muse': ('meta-contributor/muse-spark-1.3-contributor','xhigh','meta-contributor'),
          'agy': ('gemini-3.8-flash-high','high','google-antigravity')}


def run(route, prompt, outdir):
    digest = hashlib.sha256(prompt.read_bytes()).hexdigest()
    contract = dict(task_id=route + '-' + digest, contract_sha256=digest, tree=str(outdir),
                    reserved_usd=.10, max_attempts=2)
    with RunLease(ROOT/'.recovery-runtime/pipeline-probe-limits.sqlite', str(uuid.uuid4()), contract):
        return _run(route, prompt, outdir)


def _run(route, prompt, outdir):
    policy=json.loads((ROOT/'docs/handoff/CURRENT.json').read_text(encoding='utf-8-sig'))
    if policy.get('pipeline_completion',{}).get('bounded_probes_authorized') is not True:
        raise RuntimeError('Pipeline probes not authorized')
    if outdir.exists(): raise RuntimeError('Existing probe preserved; no automatic retry')
    if prompt.stat().st_size > 100000: raise RuntimeError('Probe input too large')
    outdir.mkdir(parents=True)
    model,effort,provider=ROUTES[route]
    ledger_args=[sys.executable,str(LEDGER)]
    rid=subprocess.check_output(ledger_args+['start','--harness','agy' if route=='agy' else 'omp',
        '--provider',provider,'--model',model,'--reasoning',effort,'--worktree',str(outdir),
        '--prompt-file',str(prompt),'--log',str(outdir/'receipt.json'),'--lane',outdir.name,
        '--summary','Owner-authorized synthetic pipeline probe; no game tools'],creationflags=FLAGS,text=True).strip().splitlines()[-1]
    env=os.environ.copy(); env['NODE_OPTIONS']='--max-old-space-size=1024'
    if route!='glm': env.pop('ZAI_API_KEY',None)
    if route=='agy':
        command=[str(AGY),'--print',prompt.read_text(encoding='utf-8-sig'),'--model',model,
                 '--effort',effort,'--mode','plan','--sandbox','--output-format','json',
                 '--disable-slash-commands','--print-timeout','180s']
    else:
        command=[str(OMP),'-p','@'+str(prompt),'--model',model,'--thinking',effort,'--mode','json',
                 '--no-tools','--no-extensions','--no-skills','--no-rules','--no-session',
                 '--no-title','--no-prewalk','--no-pty','--no-lsp','--max-time','3m','--cwd',str(outdir)]
    receipt=dict(run_id=rid,requested_model=model,requested_effort=effort,actual_model=None,
                 actual_provider=None,effort_acknowledged=None,accepted=False,
                 prompt_sha256=hashlib.sha256(prompt.read_bytes()).hexdigest(),usage=[],
                 billing_class='subscription' if route in {'glm','agy'} else 'metered',
                 cost_authority='OMP estimates are not provider invoice or subscription quota measurement')
    receipt['local_reservation_usd'] = .10
    started=time.monotonic(); child=None
    try:
        child=subprocess.Popen(command,cwd=outdir,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                               stdin=subprocess.DEVNULL,creationflags=FLAGS)
        output,errors=child.communicate(timeout=195)
        receipt['exit_code']=child.returncode
        receipt['stderr_present']=bool(errors)
        if len(output)>2*1024*1024: raise RuntimeError('Probe response bound exceeded')
        answers=[]; metadata=[]
        for line in output.decode('utf-8',errors='replace').splitlines():
            try: event=json.loads(line)
            except ValueError: continue
            if not isinstance(event,dict): continue
            message=event.get('message',{})
            if event.get('type')=='message_end' and message.get('role')=='assistant':
                receipt['actual_model']=message.get('model')
                receipt['actual_provider']=message.get('provider')
                if message.get('usage'): receipt['usage'].append(message['usage'])
                receipt['stop_reason']=message.get('stopReason')
                if message.get('errorMessage'): receipt['provider_error']=True
                for part in message.get('content',[]):
                    if part.get('type')=='text': answers.append(part.get('text',''))
            # AGY's public JSON result may omit all serving metadata. Never infer it.
            if route=='agy':
                for key in ('result','response','text'):
                    if isinstance(event.get(key),str): answers.append(event[key])
                for key in ('model','usage','type','is_error'):
                    if key in event: metadata.append({key:event[key]})
        receipt['agy_exposed_metadata']=metadata
        (outdir/'answer.txt').write_text('\n'.join(answers),encoding='utf-8')
        receipt['answer_sha256']=hashlib.sha256((outdir/'answer.txt').read_bytes()).hexdigest()
        receipt['response_received']=bool(answers)
    except subprocess.TimeoutExpired:
        receipt['exit_code']=124; receipt['timed_out']=True
        if child:
            subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True,creationflags=FLAGS)
            child.communicate(timeout=20)
    except Exception as exc:
        receipt['exit_code']=2; receipt['error_type']=type(exc).__name__
    finally:
        receipt['duration_seconds']=round(time.monotonic()-started,3)
        (outdir/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        ok=receipt.get('exit_code')==0 and receipt.get('response_received') and not receipt.get('provider_error')
        subprocess.run(ledger_args+['finish','--run-id',rid,'--exit-code',str(receipt.get('exit_code',2)),
            '--status','completed' if ok else 'failed','--keep-state'],capture_output=True,creationflags=FLAGS)
    print(json.dumps(receipt))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--route',choices=ROUTES,required=True); p.add_argument('--prompt',type=Path,required=True)
    p.add_argument('--name',required=True)
    a=p.parse_args()
    if not a.name.replace('-','').isalnum(): p.error('Simple probe name required')
    run(a.route,a.prompt.resolve(),ROOT/'.recovery-runtime/pipeline-completion-20260920'/a.name)
