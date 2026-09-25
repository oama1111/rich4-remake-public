# 原版 Watcom qsort（0x457e6c）预言机：在 Unicorn 里跑原版机器码（配原版比较器 0x42d0ef / 0x42bed0），
# 产出随机用例供 rules/watcom-qsort.ts 逐位对照。跑法：cd ../rich4-spec && .venv/bin/python ../wt28/ai-econ/tools/audit/qsort-oracle.py out.json
# 段寄存器 push/pop 打成等长桩（Unicorn 平坦模式装不了段选择子）。

import sys, os, json, random, struct
sys.path.insert(0, '/Volumes/Kingston/大富翁4重制版/rich4-spec/tools')
from emulate import Emu, SCRATCH_BASE
emu = Emu()
NOP=b'\x90'
for va,code in [(0x457ddf,bytes.fromhex('5151905190')),(0x457e3d,bytes.fromhex('5990599059')),(0x457e6f,bytes.fromhex('5151905190')),
                (0x457e46,NOP*3),(0x457e6a,NOP),(0x45817d,NOP*3),(0x4581a1,NOP),(0x4581c3,NOP*3),(0x4581e7,NOP)]:
    emu.patch(va, code)
random.seed(1234)
cases = {'card': [], 'stock': [], 'prices': []}
for idx in range(30):
    cases['prices'].append(emu.read8(0x47fdf7 + idx*8))
BUF = SCRATCH_BASE + 0x100
for t in range(400):
    n = random.choice([random.randint(0, 20), random.randint(15, 50), random.randint(40, 160)])
    pool = random.sample(range(30), random.randint(1, 30))
    arr = [random.choice(pool) for _ in range(n)]
    emu.scratch_write(BUF, bytes(arr) + b'\0')
    emu.call(0x457e6c, [BUF, n, 1, 0x42d0ef], timeout_insns=5_000_000)
    out = list(emu.scratch_read(BUF, n))
    cases['card'].append({'in': arr, 'out': out})
for t in range(400):
    recs = []
    for i in range(12):
        s = random.choice([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]) if random.random() < 0.8 else random.randint(0, 20)
        recs.append(((i << 16) | s) if random.random() < 0.9 else 0)
    emu.scratch_write(BUF, b''.join(struct.pack('<I', r) for r in recs))
    emu.call(0x457e6c, [BUF, 12, 4, 0x42bed0], timeout_insns=5_000_000)
    out = [struct.unpack('<I', emu.scratch_read(BUF + 4*i, 4))[0] for i in range(12)]
    cases['stock'].append({'in': recs, 'out': out})
json.dump(cases, open(sys.argv[1] if len(sys.argv) > 1 else 'qsort-cases.json', 'w'))
print('ok', len(cases['card']), len(cases['stock']), cases['prices'])
