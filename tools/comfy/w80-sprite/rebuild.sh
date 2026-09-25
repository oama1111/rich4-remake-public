#!/bin/zsh
cd /private/tmp/claude-501/-Volumes-Kingston----4---/dbac8e2a-6ecb-41eb-93c7-2fd62f5059f2/scratchpad
for k in x9 x10 x11 a0 a1 a2 a3 npc datamisc mapobj x6 c6; do
  node --experimental-strip-types g-build.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json > /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/rebuild-$k.log 2>&1
  if [ $k = c6 ]; then
    for d in 0 1 2 3 4 5 6 7; do cp /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/c6/dice$d-soft.png /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/c6/dice$d-soft4.png; done
    node --experimental-strip-types cast-jobs.ts 6 >> /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/rebuild-$k.log 2>&1
  else
    node --experimental-strip-types g-jobs.ts /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/specs/$k.json >> /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/rebuild-$k.log 2>&1
  fi
  echo "$(date +%H:%M) 重建 $k" >> /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/master.log
done
# 宫本宝藏两套：旧产物挪开，续跑时重做
for k in x6 c6; do mkdir -p /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/$k/out2-green; mv /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/$k/out2/*.png /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/fringe-pilot/cast/$k/out2-green/ 2>/dev/null; done
echo "$(date +%H:%M) 重建完成" >> /Volumes/Kingston/大富翁4重制版/wt-hd/assets/work/master.log
