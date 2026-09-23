#!/bin/zsh
# W-80 全量收尾：四条路线的云端产物 → 合并（边缘处理）→ 分路线入库记账 → Q 择优 → 比对 → 网页档
# 用法：tools/comfy/w80-finish.sh <work 目录>（在仓库根目录跑；S/V/Q/G 四个 run 都跑完之后）
set -e
W=${1:-assets/work}
HD=assets/hd

echo "① S：拆拼图"
pnpm upscale unpack $W/pack $W/pack-done $W/upscale-done

echo "② V：归位 + 子队列；alpha 用队列里的 1× 放大 4×"
node --experimental-strip-types tools/comfy/w80-place-v.ts $W
for id in $(python3 -c "import json;print(' '.join(json.load(open('$W/routes.json'))['V']))"); do
  a=${id%%/*}; rest=${id#*/}; r=${rest%%_*}; i=${rest#*_}
  src=$W/queue/alpha/$a/${r}_f${i}.png; out=$W/upscale-done/alpha/$a/${r}_f${i}.png
  [ -f $out ] && continue
  mkdir -p $(dirname $out)
  w=$(sips -g pixelWidth $src | tail -1 | awk '{print $2}'); h=$(sips -g pixelHeight $src | tail -1 | awk '{print $2}')
  sips -z $((h*4)) $((w*4)) $src --out $out >/dev/null
done

echo "③ G：底图羽化拼回"
node --experimental-strip-types tools/comfy/w80-ground.ts stitch $W

echo "④ 合并（轮廓平滑 + 边缘带取原图 + 暗边去残色）"
pnpm upscale merge $W/queue $W/upscale-done

echo "⑤ 按路线入库，清单记真实做法"
pnpm upscale assemble $W/queue-S $W/upscale-done $HD seedvr2-7b-int8-lab-seed42-sheet-edge
pnpm upscale assemble $W/queue-V $W/upscale-done $HD seedvr2-7b-int8-video-chunk-preblur0.9-seed42-edge
pnpm upscale assemble $W/queue-G $W/upscale-done $HD qwen-image-2.1-img2img-d0.5-tile576+seedvr2-7b-feather

echo "⑥ Q 择优（过重绘档才替换）+ 记账"
node --experimental-strip-types tools/comfy/w80-choose-q.ts $W $HD
pnpm upscale ingest $W/assets-clean $HD qwen-image-2.1-repaint-x2pad32-seed20260923+seedvr2-7b-lab

echo "⑦ 回缩比对（按模型名自动分档）"
pnpm upscale gate $HD $W/assets-clean || true

echo "⑧ 网页 2× 档"
pnpm upscale tier $HD assets/hd-2x 2
