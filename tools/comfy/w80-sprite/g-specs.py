# 生成 spec：角色其他 18 套（按交通方式 × 朝向分组；三种特殊服装按服装分组）+ 替身 + 机器娃娃 + 神像
import json, collections, os, sys
W='/Volumes/Kingston/大富翁4重制版/wt-hd/assets/work'
c=json.load(open(W+'/assets-clean/manifest.json'))['images']
cnt=collections.Counter((i['archive'],i['resource']) for i in c if i['archive']=='Data')
iid=lambda r,i:'Data/%04d_%03d'%(r,i)
def per(r): return cnt[('Data',r)]//8
VEH={'moto':(3,'骑着一辆摩托车（车身、车轮、车把、排气管都要清楚，摩托车的颜色和样式与图1一致）'),
     'car':(6,'坐在一辆小汽车里开车（车身、车灯、车轮、挡风玻璃都要清楚，汽车的颜色和样式与图1一致）'),
     'dozer':(9,'驾驶一辆带履带和机械臂的黄色工程车（履带、机械臂、驾驶座都要清楚，颜色和样式与图1一致）'),
     'boat':(13,'站在一艘红白配色的快艇上（船身、船头、驾驶台都要清楚，颜色和样式与图1一致）'),
     'walkb':(16,'步行（与普通走路相同的服装）')}
specs=[]
for ch in range(12):
    base=128+21*ch; groups=[]
    for vk,(k0,desc) in VEH.items():
        rs=[base+k0+j for j in range(4 if vk=='dozer' else (2 if vk=='walkb' else 3))]
        for d in range(8):
            ids=[]; hasdice=False
            for j,r in enumerate(rs):
                p=per(r); ids+= [iid(r,d*p+i) for i in range(p)]
                if vk!='walkb' and j==len(rs)-1: hasdice=True
            n=len(ids); cols=3 if n<=9 else 4
            groups.append({'name':f'{vk}{d}','ids':ids,'cols':cols,'sig':4,'dir':d,'vehicle':desc,'dice':hasdice,'diceRes':rs[-1] if hasdice else None})
    for k,(nm,desc) in {18:('beggar','换上了破破烂烂、打着补丁的乞丐装（不再穿上面描述的平时服装；帽子/头饰也变得旧旧的、有补丁，脸和发型不变）'),19:('hospital','换上了白色的病号服/住院服（不再穿上面描述的平时服装，帽子/头饰、脸和发型不变）'),20:('prison','换上了黑白横条纹的囚服（不再穿上面描述的平时服装，帽子/头饰、脸和发型不变）')}.items():
        r=base+k; ids=[iid(r,d) for d in range(8)]
        groups.append({'name':nm,'ids':ids,'cols':4,'sig':4,'dir':'mixed','outfit':desc})
    specs.append({'key':f'x{ch}','char':ch,'portrait':['Data',2,ch],'turnaround':[iid(base,d) for d in range(8)],'groups':groups})
ACT={0:('小偷','一个蒙面小偷：紫色的大圆头巾，额前一条镶黄色方块的头带，白色面罩遮住下半张脸，紫色的紧身衣、手套和靴子，身后背着一个深蓝色的大包袱。'),
     1:('强盗','一个肌肉发达的壮汉强盗：深绿色短发（头顶竖起一撮），眼睛上蒙着一条蓝色眼罩，白色背心，红色短裤，深绿色长裤，手腕戴绿色护腕，粗壮的手臂。'),
     2:('流氓','一个流氓：一大丛向上扇形竖起的绿色刺猬头，戴紫色墨镜，棕色皮肤，穿黑色皮夹克和黑色长裤，紫色的鞋子。'),
     3:('间谍','一个间谍：光头，头顶扎一个小小的发髻，戴绿色的护目镜，穿黑色的长风衣，表情阴沉。')}
for a,(nm,brief) in ACT.items():
    base=380+4*a; groups=[]
    for d in range(8):
        ids=[iid(base,d)]+[iid(base+1,d*per(base+1)+i) for i in range(per(base+1))]
        groups.append({'name':f'walk{d}','ids':ids,'cols':4 if len(ids)<=12 else 5,'sig':4,'dir':d})
        ids=[iid(base+2,d*per(base+2)+i) for i in range(per(base+2))]
        groups.append({'name':f'boat{d}','ids':ids,'cols':3 if len(ids)<=9 else 4,'sig':4,'dir':d,'vehicle':VEH['boat'][1]})
        ids=[iid(base+3,d*per(base+3)+i) for i in range(per(base+3))]
        groups.append({'name':f'sleep{d}','ids':ids,'cols':4 if len(ids)<=12 else 5,'sig':4,'dir':d,'extra':'这一组是梦游：闭着眼睛、双手向前伸着走路。'})
    specs.append({'key':f'a{a}','name':nm,'brief':brief,'turnaround':[iid(base,d) for d in range(8)],'groups':groups})
GODS={396:'一个坐在金色大元宝里的胖娃娃小神仙（戴墨镜），元宝金光闪闪',397:'一个穿红色官袍、戴乌纱帽、手持紫色长笏的神仙',398:'一个骑在红色大葫芦上的娃娃小神仙',399:'一个穿红色华丽官袍、胖胖的财神爷'}
gs=[{'name':f'god{r}','ids':[iid(r,d) for d in range(8)],'cols':4,'sig':4,'dir':'mixed','brief':b} for r,b in GODS.items()]
gs.append({'name':'doll','ids':[iid(521,d) for d in range(8)],'cols':4,'sig':4,'dir':'mixed','brief':'一个机器娃娃：青绿色的蛋形机器人身体，金色的边饰和把手，黄绿色的头顶，胸前有紫色的圆形徽章'})
for d in range(8):
    p=per(522); gs.append({'name':f'dollw{d}','ids':[iid(522,d*p+i) for i in range(p)],'cols':3,'sig':4,'dir':d,'brief':gs[-1-d]['brief'] if d==0 else gs[4]['brief']})
specs.append({'key':'npc','turnaround':None,'groups':gs})
sz={(i['archive'],i['resource'],i['image']):(i['width'],i['height']) for i in c}
def mp(ids,cols,k=6):
    ws=[sz[(x[:x.index('/')],int(x[x.index('/')+1:x.index('_')]),int(x[x.index('_')+1:]))] for x in ids]
    cw=max(w for w,h in ws)*k+48; ch=max(h for w,h in ws)*k+48; rows=-(-len(ids)//cols)
    return (cw*cols+48)*(ch*rows+48)/1e6
def split(gs):
    out=[]
    for g in gs:
        if len(g['ids'])>1 and mp(g['ids'],g['cols'],g.get('k',6))>2.6:
            h=len(g['ids'])//2
            for n,part in enumerate((g['ids'][:h],g['ids'][h:])):
                gg=dict(g); gg['ids']=part; gg['name']=g['name']+'ab'[n]; gg['cols']=3 if len(part)<=9 else 4
                out+=split([gg])
        else: out.append(g)
    return out
for s_ in specs: s_['groups']=split(s_['groups'])
os.makedirs(W+'/fringe-pilot/specs',exist_ok=True)
tot=0
for s in specs:
    json.dump(s,open(f"{W}/fringe-pilot/specs/{s['key']}.json",'w'),ensure_ascii=False,indent=1); tot+=len(s['groups'])
print(len(specs),'个 spec，共',tot,'组，', sum(len(g['ids']) for s in specs for g in s['groups']),'帧')
# 需要剔杂色 + 忠实放大的拼图
L=json.load(open(W+'/pack/layout.json'))
need=set(i[:9] for s in specs for g in s['groups'] for i in g['ids'])
sheets=sorted({sh['name'] for sh in L['sheets'] for cc in sh['cells'] if cc['id'][:9] in need})
open(W+'/fringe-pilot/specs/sheets.txt','w').write('\n'.join(sheets)); print(len(sheets),'张拼图')
