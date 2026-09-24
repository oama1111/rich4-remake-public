#!/bin/zsh
# W-80 剩余素材总调度（按序）：等 rest-A → sheets2 剔杂色+忠实放大 → 各 spec 构建+重绘
cd /Volumes/Kingston/大富翁4重制版/wt-hd
S=/private/tmp/claude-501/-Volumes-Kingston----4---/dbac8e2a-6ecb-41eb-93c7-2fd62f5059f2/scratchpad
export COMFY_URL=${COMFY_URL:?} COMFY_AHEAD=2
log() { echo "$(date +%H:%M) $*"; }
while pgrep -f 'rest-A.jobs.json' >/dev/null; do sleep 60; done
log "rest-A 完成 $(grep -c '失败：' assets/work/rest-A.run.log) 失败"
# 地图/杂项拼图：剔杂色 + alpha4（本地）
SH2=(${(f)"$(cat assets/work/fringe-pilot/specs/sheets2.txt)"})
node --experimental-strip-types tools/comfy/w80-fringe.ts assets/work assets/work/fringe-pilot/in-strip --strip $SH2
for s in $SH2; do f=assets/work/fringe-pilot/in-strip/alpha/$s.png; o=assets/work/fringe-pilot/in-strip/alpha4/$s.png; mkdir -p $(dirname $o); w=$(sips -g pixelWidth $f | tail -1 | awk '{print $2}'); h=$(sips -g pixelHeight $f | tail -1 | awk '{print $2}'); sips -z $((h*4)) $((w*4)) $f --out $o >/dev/null; done
python3 - <<'PY'
import json
S={j['id']:j for j in json.load(open('assets/work/s.jobs.json'))['jobs']}
jobs=[]
for name in open('assets/work/fringe-pilot/specs/sheets2.txt').read().split():
    b=dict(S['S-'+name.replace('/','-')]); b['id']='FPA-'+name.replace('/','-'); b['upload']='fringe-pilot/in-strip/rgb/'+name+'.png'; b['input']='rich4-pilot/work/fa/'+name+'.png'; b['out']='fringe-pilot/done-A/rgb/'+name+'.png'; jobs.append(b)
json.dump({'jobs':jobs},open('assets/work/rest-A2.jobs.json','w'),ensure_ascii=False,indent=1)
PY
# 角色/NPC 的构建不依赖 A2：先构建第一批，A2 与第一批重绘排在同一队列
KEYS1=(x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 x11 a0 a1 a2 a3 npc)
for k in $KEYS1; do (cd $S && node --experimental-strip-types g-build.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json && node --experimental-strip-types g-jobs.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json) || log "构建 $k 失败"; done
log "第一批构建完成"
node --experimental-strip-types tools/comfy/pilot.ts run assets/work/rest-A2.jobs.json > assets/work/rest-A2.run.log 2>&1
log "rest-A2 完成 $(grep -c '失败：' assets/work/rest-A2.run.log) 失败"
for k in datamisc mapobj; do (cd $S && node --experimental-strip-types g-build.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json && node --experimental-strip-types g-jobs.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json) > assets/work/build-$k.log 2>&1 &; done
for k in $KEYS1; do node --experimental-strip-types tools/comfy/pilot.ts run assets/work/g-$k.jobs.json > assets/work/g-$k.run.log 2>&1; log "$k 完成 $(grep -c '失败：' assets/work/g-$k.run.log) 失败"; done
wait
for k in datamisc mapobj; do node --experimental-strip-types tools/comfy/pilot.ts run assets/work/g-$k.jobs.json > assets/work/g-$k.run.log 2>&1; log "$k 完成 $(grep -c '失败：' assets/work/g-$k.run.log) 失败"; done
log "全部完成"
