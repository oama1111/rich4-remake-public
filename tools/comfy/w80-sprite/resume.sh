#!/bin/zsh
# 续跑：断点续跑（已有产物的任务自动跳过），失败的每个 key 再补一轮
cd /Volumes/Kingston/大富翁4重制版/wt-hd
export COMFY_URL=${COMFY_URL:?} COMFY_AHEAD=2
log() { echo "$(date +%H:%M) $*" >> assets/work/master.log; }
log "续跑开始"
for k in x7 x8 x9 x10 x11 a0 a1 a2 a3 npc datamisc mapobj x0 x1 x2 x3 x4 x5 x6; do
  for pass in 1 2; do
    node --experimental-strip-types tools/comfy/pilot.ts run assets/work/g-$k.jobs.json > assets/work/g-$k.run$pass.log 2>&1
    n=$(grep -c '失败：' assets/work/g-$k.run$pass.log); [ $n -eq 0 ] && break
  done
  log "$k 完成 $n 失败"
done
log "全部完成"
