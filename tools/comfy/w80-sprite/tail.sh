#!/bin/zsh
# 等续跑结束，再重做宫本宝藏走路/骰子套（c6，换底色）
cd /Volumes/Kingston/大富翁4重制版/wt-hd
while pgrep -f 'assets/work/resume.sh' >/dev/null || pgrep -f 'assets/work/rebuild.sh' >/dev/null; do sleep 120; done
export COMFY_URL=${COMFY_URL:?} COMFY_AHEAD=2
for pass in 1 2; do node --experimental-strip-types tools/comfy/pilot.ts run assets/work/cast-c6.jobs.json > assets/work/cast-c6.rerun$pass.log 2>&1; n=$(grep -c '失败：' assets/work/cast-c6.rerun$pass.log); [ $n -eq 0 ] && break; done
echo "$(date +%H:%M) c6 重做完成 $n 失败" >> assets/work/master.log
echo "$(date +%H:%M) 云端全部结束" >> assets/work/master.log
