"""Use the existing native AKP runner, recorded in the existing shared run ledger."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
AKP=Path(r'C:\Users\david\Desktop\stuff\akp-passport')
LEDGER=Path(r'C:\Users\david\projects\worktrees\provider-refresh-20260909\scripts\record_delegated_run.py')
FLAGS=getattr(subprocess,'CREATE_NO_WINDOW',0)
ROUTES={
 'OMP':(r'C:\Users\david\.omp\agent\AGENTS.md','omp','meta-contributor','meta-contributor/muse-spark-1.3-contributor','xhigh'),
 'Antigravity':(r'C:\Users\david\.gemini\config\AGENTS.md','agy','google-antigravity','gemini-3.8-flash-high','high'),
 'Claude Code':(r'C:\Users\david\.claude\CLAUDE.md','claude','anthropic','sonnet','medium'),
 'Hermes':(r'C:\Users\david\AppData\Local\hermes\AGENTS.md','hermes','zai','glm-5.3-flash','high')}

def main():
 p=argparse.ArgumentParser();p.add_argument('--harness',choices=ROUTES,required=True)
 p.add_argument('--attempt',type=int,choices=[1,2],default=1);a=p.parse_args()
 policy=json.loads((ROOT/'docs/handoff/CURRENT.json').read_text(encoding='utf-8-sig'))
 if policy.get('pipeline_completion',{}).get('bounded_probes_authorized') is not True: p.error('Hold')
 bootstrap,harness,provider,model,effort=ROUTES[a.harness]
 folder=ROOT/'.recovery-runtime/pipeline-completion-20260920'/('adoption-'+harness+('' if a.attempt==1 else '-repair'))
 folder.mkdir(exist_ok=False)
 instructions='''\nDave explicitly authorizes this bounded native adoption check; no game development or other delegation.
Before returning proof JSON, actually read your bootstrap adapter and the current AKP bootstrap_read_set,
principles.md, rules/shared-bootstrap-portability.md and rules/evidence-bound-pipeline.md from
C:/Users/david/Desktop/stuff/akp-passport using native file tools. Read the shared skill generated-asset-rigging
through your native skills root and its references/blender-rigging-workflow.md.
Run python -m unittest discover -s scripts/orchestration -p test_task_contract.py from
C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919. Its negative test must reject missing evidence.
Only read these non-secret controls and run that fixture. Do not inspect auth, env, logs, sessions or credential files;
do not invoke providers, change controls, push, spawn agents or run game/GPU jobs. Do not copy a peer proof.
Then return only the requested proof JSON, plus native_observations containing the skill path,
one export invariant, test result, and missing_evidence_decision='hold'. If a check is unavailable say blocked.
'''
 fullprompt='{prompt}'+instructions
 if harness=='omp': cmd=[r'C:\Users\david\AppData\Roaming\npm\omp.exe','-p',fullprompt,'--model',model,'--thinking',effort,'--no-session','--no-title','--no-extensions','--no-lsp','--no-pty','--max-time','5m']
 elif harness=='agy': cmd=[r'C:\Users\david\AppData\Local\agy\bin\agy.exe','--print',fullprompt,'--model',model,'--effort',effort,'--dangerously-skip-permissions','--print-timeout','300s']
 elif harness=='claude': cmd=[r'C:\Users\david\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe','--print',fullprompt,'--model',model,'--effort',effort,'--max-budget-usd','0.20','--permission-mode','dontAsk','--tools','Read,Bash,Glob,Grep']
 else: cmd=[r'C:\Users\david\AppData\Local\hermes\bin\hermes.exe','chat','--query',fullprompt,'--oneshot','-Q','--provider',provider,'-m',model,'--reasoning',effort,'--max-turns','12','--run-budget','300','--in',str(ROOT)]
 cfg=folder/'runners.json';cfg.write_text(json.dumps({'machines':{'dave-gaming-pc':{a.harness:{'argv':cmd,'verified':False,'timeout_s':330}}}},indent=2))
 prompt=folder/'scope.md';prompt.write_text(instructions,encoding='utf-8')
 rid=subprocess.check_output([sys.executable,str(LEDGER),'start','--harness',harness,'--provider',provider,
  '--model',model,'--reasoning',effort,'--worktree',str(AKP),'--prompt-file',str(prompt),
  '--log',str(folder/'receipt.json'),'--lane','native-adoption-'+harness,'--summary','Native current-control and skill adoption test'],creationflags=FLAGS,text=True).strip().splitlines()[-1]
 started=time.monotonic()
 result=subprocess.run([sys.executable,str(AKP/'scripts/akp_attest_runner.py'),'--harness',a.harness,
  '--machine','dave-gaming-pc','--bootstrap',bootstrap,'--config',str(cfg),'--allow-unverified','--timeout','330'],
  cwd=AKP,capture_output=True,text=True,encoding='utf-8',errors='replace',creationflags=FLAGS,timeout=370)
 # The native runner's proof/receipt is the evidence. Keep only its bounded summary here.
 receipt=dict(run_id=rid,harness=a.harness,requested_model=model,requested_effort=effort,
  actual_model=None,exit_code=result.returncode,duration_seconds=round(time.monotonic()-started,2),
  runner_summary=result.stdout[-3500:],runner_stderr_present=bool(result.stderr),game_worker=False)
 (folder/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
 subprocess.run([sys.executable,str(LEDGER),'finish','--run-id',rid,'--exit-code',str(result.returncode),
  '--status','completed' if result.returncode==0 else 'failed','--keep-state'],capture_output=True,creationflags=FLAGS)
 print(json.dumps(receipt))

if __name__=='__main__': main()
