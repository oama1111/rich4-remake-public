# 地图物件 + Data 杂项（角色小人、NPC、头像）
import json, collections, math, os
W='/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work'
c=json.load(open(W+'/assets-clean/manifest.json'))['images']
by=collections.defaultdict(list)
for i in c: by[(i['archive'],i['resource'])].append(i)
iid=lambda a,r,i:'%s/%04d_%03d'%(a,r,i)
def groups_for(a,r,name,extra):
    xs=sorted(by[(a,r)],key=lambda i:i['image']); md=max(max(i['width'],i['height']) for i in xs)
    k=6 if md<100 else 4
    cell=lambda i:(i['width']*k+48)*(i['height']*k+48)
    out=[]; cur=[]
    for i in xs:
        if cur and (sum(cell(j) for j in cur)+cell(i))*1.15>2.4e6 or len(cur)>=12: out.append(cur); cur=[]
        cur.append(i)
    if cur: out.append(cur)
    gs=[]
    for n,chunk in enumerate(out):
        ids=[iid(a,r,i['image']) for i in chunk]; cols=max(1,min(4,math.ceil(math.sqrt(len(ids)))))
        gs.append(dict(name=f'{name}-{n}',ids=ids,cols=cols,sig=4,k=k,dir='mixed',**extra))
    return gs
specs=[]
# 地图物件：排除底图（0..15 偶数）与 400×400 预览（16..23）
mg=[]
for (a,r),xs in by.items():
    if a!='map' or r<=23: continue
    mg+=groups_for(a,r,f'm{r}',{'obj':True})
specs.append({'key':'mapobj','turnaround':None,'groups':mg})
dg=[]
names=['约翰乔','沙隆巴斯','忍太郎','钱夫人','阿土伯','莎拉公主','宫本宝藏','糖糖','乌咪','孙小美','小丹尼','金贝贝']
for r in range(416,440): dg+=groups_for('Data',r,f'd{r}',{'char':(r-416)//2})
for r in range(400,414): dg+=groups_for('Data',r,f'd{r}',{'brief':'《大富翁4》里的一个神仙/NPC 小人物（按图1的造型、配色和道具画）'})
dg+=groups_for('Data',2,'d2',{'brief':'《大富翁4》12 位角色的头像（每一格是一位不同的角色：'+'、'.join(names)+'，依次排列），头像带方形的彩色背景和白色描边框，背景与边框保持不变'})
dg+=groups_for('Data',3,'d3',{'obj':True})
specs.append({'key':'datamisc','turnaround':None,'groups':dg})
for s in specs: json.dump(s,open(f"{W}/fringe-pilot/specs/{s['key']}.json",'w'),ensure_ascii=False,indent=1)
print('地图物件',len(mg),'组',sum(len(g['ids']) for g in mg),'帧；Data 杂项',len(dg),'组',sum(len(g['ids']) for g in dg),'帧')
L=json.load(open(W+'/pack/layout.json')); need=set(i[:len(i)-4] for s in specs for g in s['groups'] for i in g['ids'])
sheets=sorted({sh['name'] for sh in L['sheets'] for cc in sh['cells'] if cc['id'][:len(cc['id'])-4] in need})
open(W+'/fringe-pilot/specs/sheets2.txt','w').write('\n'.join(sheets)); print(len(sheets),'张拼图')
