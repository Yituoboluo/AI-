from pathlib import Path
import re, html, json, sys, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path.cwd()
WORK = ROOT / 'draft_a3706042_folder'
SRC = ROOT / '交付文档' / '造物营_PRD_Skill标准版_V1.0.md'

def esc(s):
    return html.escape(s, quote=True)

def svg_start(w, h, title, subtitle):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
            f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>',
            f'<text x="36" y="44" font-family="Noto Sans SC" font-size="25" font-weight="700" fill="#1f2937">{esc(title)}</text>',
            f'<text x="36" y="76" font-family="Noto Sans SC" font-size="16" fill="#4b5563">{esc(subtitle)}</text>']

def box(parts, x, y, w, h, lines, kind='action'):
    fill = '#f4f5f7' if kind == 'data' else '#ffffff'
    if kind == 'decision':
        pts = f'{x+w/2},{y} {x+w},{y+h/2} {x+w/2},{y+h} {x},{y+h/2}'
        parts.append(f'<polygon points="{pts}" fill="#f4f5f7" stroke="#374151" stroke-width="1.5"/>')
    elif kind == 'external':
        parts.append(f'<ellipse cx="{x+w/2}" cy="{y+h/2}" rx="{w/2}" ry="{h/2}" fill="#ffffff" stroke="#374151" stroke-width="1.5"/>')
    else:
        parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="#374151" stroke-width="1.5"/>')
    first = y + h/2 - (len(lines)-1)*12 + 6
    for i,line in enumerate(lines):
        parts.append(f'<text x="{x+w/2}" y="{first+i*25}" text-anchor="middle" font-family="Noto Sans SC" font-size="18" fill="#1f2937">{esc(line)}</text>')

def edge(parts, coords, label=None, lx=None, ly=None):
    points=' '.join(f'{x},{y}' for x,y in coords)
    parts.append(f'<polyline points="{points}" fill="none" stroke="#4b5563" stroke-width="1.8"/>')
    x,y=coords[-1]; px,py=coords[-2]
    if x>px: tip=f'{x},{y} {x-8},{y-4} {x-8},{y+4}'
    elif x<px: tip=f'{x},{y} {x+8},{y-4} {x+8},{y+4}'
    elif y>py: tip=f'{x},{y} {x-4},{y-8} {x+4},{y-8}'
    else: tip=f'{x},{y} {x-4},{y+8} {x+4},{y+8}'
    parts.append(f'<polygon points="{tip}" fill="#4b5563"/>')
    if label:
        parts.append(f'<text x="{lx}" y="{ly}" font-family="Noto Sans SC" font-size="15" fill="#374151">{esc(label)}</text>')

def finish(parts,name):
    parts.append('</svg>'); p=WORK/name; p.write_text('\n'.join(parts),encoding='utf-8'); ET.parse(p); return p

def make_diagrams():
    p=svg_start(1100,670,'图片创作与质量闭环','每一步关联输入和成品版本；有成品不等于人工合格或采用')
    positions=[(40,125),(305,125),(570,125),(835,125),(835,285),(570,285),(305,285),(40,285)]
    labels=[['进入本人项目','上传并保留原图'],['预处理与设置','1或3方向、比例与约束'],['冻结输入与版本','分析商品和方向计划'],['各方向独立生成','保留实际调用证据'],['合成、存储、检查','完整／部分交付'],['查看与调整','新版本重新验收'],['人工质量评审','三门、四维、修改量'],['是否合格且采用']]
    for (x,y),lines in zip(positions,labels): box(p,x,y,225,90,lines)
    for x in (265,530,795): edge(p,[(x,170),(x+40,170)])
    edge(p,[(947,215),(947,285)])
    for x in (835,570,305): edge(p,[(x,330),(x-40,330)])
    box(p,40,480,225,85,['有效采用','生产task去重'],kind='data')
    box(p,365,480,300,85,['Badcase归因、修复、回归','原底图重合成或新真实执行'],kind='data')
    edge(p,[(100,375),(100,480)],'是',115,430)
    edge(p,[(210,375),(210,430),(515,430),(515,480)],'否',355,416)
    edge(p,[(665,523),(750,523),(750,420),(418,420),(418,375)],'新版本／新证据',767,477)
    finish(p,'01-main.svg')

    p=svg_start(1080,630,'失败处理：先核验，再决定恢复或重试','成功方向保留；恢复只取回原结果；新生成需要明确选择')
    box(p,40,125,240,90,['未完整交付','保留成功成品与阶段'])
    box(p,365,120,285,100,['原结果是否可取回'],kind='decision')
    box(p,770,125,255,90,['恢复下载与补存储','新增生成调用=0'],kind='data')
    box(p,365,330,285,85,['状态未知：核验原请求','不自动追加付费调用'])
    box(p,40,470,280,95,['结果缺失或已失效','说明新调用与重试范围'])
    box(p,420,470,285,95,['用户明确选择','创建关联新执行'])
    box(p,790,470,235,95,['按新执行计用量','记录实际交付'])
    edge(p,[(280,170),(365,170)])
    edge(p,[(650,170),(770,170)],'有效',683,156)
    edge(p,[(507,220),(507,330)],'未知',524,276)
    edge(p,[(650,372),(714,372),(714,275),(507,275),(507,220)])
    edge(p,[(365,170),(320,170),(320,300),(180,300),(180,470)],'没有／过期',71,286)
    edge(p,[(320,517),(420,517)])
    edge(p,[(705,517),(790,517)])
    finish(p,'02-recovery.svg')

    p=svg_start(1120,720,'数据流与证据边界','原图、结果、业务反馈与评分分开保存；仅明确送达的证据可被评估')
    box(p,35,150,185,95,['创作者','原图与约束'],kind='external')
    box(p,305,150,220,95,['PC工作台','登录与本地草稿'])
    box(p,630,150,225,95,['项目／任务服务','冻结输入与权限'])
    box(p,905,145,185,105,['分析／图像供应商','结果与用量'],kind='external')
    edge(p,[(220,198),(305,198)]); edge(p,[(525,198),(630,198)])
    edge(p,[(855,181),(905,181)],'请求',864,163)
    edge(p,[(905,220),(855,220)],'结果',864,244)
    box(p,620,350,210,85,['元数据存储','项目、任务与版本'],kind='data')
    box(p,875,350,210,85,['图片存储','原图与实际成品'],kind='data')
    box(p,305,350,230,85,['质量与问题记录','人工反馈、回归'],kind='data')
    edge(p,[(695,245),(695,350)])
    edge(p,[(810,245),(810,292),(980,292),(980,350)])
    edge(p,[(415,245),(415,350)],'反馈',429,298)
    edge(p,[(535,392),(620,392)])
    box(p,305,565,230,85,['评测工具','评分与复核历史'],kind='data')
    box(p,625,565,215,85,['追踪记录','阶段、用量与范围'],kind='data')
    box(p,35,555,185,105,['评审者','检查限定证据'],kind='external')
    edge(p,[(415,435),(415,565)],'限定证据',434,500)
    edge(p,[(725,435),(725,565)],'事件与阶段',744,500)
    edge(p,[(305,607),(220,607)])
    finish(p,'03-data.svg')

    p=svg_start(1080,590,'技术状态与业务交付分开判断','succeeded可能只保存2/3张；成品修改后旧采用结论不可沿用')
    box(p,55,155,200,80,['queued','待执行'])
    box(p,360,155,210,80,['running','实际执行中'])
    box(p,830,155,200,80,['succeeded','有结果的执行结束'],kind='data')
    box(p,250,340,210,85,['failed','无法完成'])
    box(p,545,340,235,85,['interrupted','连接中断'])
    edge(p,[(255,195),(360,195)],'开始',294,179)
    edge(p,[(570,195),(830,195)],'执行结束',653,179)
    edge(p,[(407,235),(407,290),(355,290),(355,340)])
    edge(p,[(515,235),(515,288),(662,288),(662,340)])
    edge(p,[(250,382),(210,382),(210,278),(360,278),(360,215)],'原结果恢复',80,314)
    edge(p,[(780,382),(800,382),(800,257),(550,257),(550,235)],'原结果恢复',832,314)
    p.append('<text x="55" y="505" font-family="Noto Sans SC" font-size="19" fill="#1f2937">业务交付：已保存数 = 请求数 → 完整；0 &lt; 已保存数 &lt; 请求数 → 部分；0 → 无成品</text>')
    p.append('<text x="55" y="543" font-family="Noto Sans SC" font-size="18" fill="#4b5563">质量状态：当前版本的自动检查 + 人工三门、四维与修改量 → 合格后人工选择采用</text>')
    finish(p,'04-state.svg')

TOKEN=re.compile(r'(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\n)]+\))')
def inline(s):
    out=[]; start=0
    for m in TOKEN.finditer(s):
        out.append(esc(s[start:m.start()])); t=m.group(0)
        if t.startswith('**'): out.append('<b>'+esc(t[2:-2])+'</b>')
        elif t.startswith('`'): out.append(esc(t[1:-1]))
        else:
            a=re.fullmatch(r'\[([^\]]+)\]\(([^)]+)\)',t)
            out.append(f'<a href="{esc(a[2])}">{esc(a[1])}</a>')
        start=m.end()
    out.append(esc(s[start:]));return ''.join(out)

def convert(src,dest,main=False):
    lines=src.read_text(encoding='utf-8').splitlines(); out=[]; i=0; tablecount=0; diagram=0; imagecount=0; codecount=0; texts=[]
    while i<len(lines):
        l=lines[i].strip()
        if not l: i+=1;continue
        if l.startswith('```'):
            lang=l[3:].strip();body=[];i+=1
            while i<len(lines) and not lines[i].strip().startswith('```'):
                body.append(lines[i]);i+=1
            code='\n'.join(body);codecount+=1
            if main and diagram<4:
                name=['01-main.svg','02-recovery.svg','03-data.svg','04-state.svg'][diagram]
                out.append(f'<whiteboard type="svg" path="@./draft_a3706042_folder/{name}"/>');diagram+=1
            out.append(f'<pre lang="{esc(lang or "text")}" caption="流程源代码"><code>{esc(code)}</code></pre>');texts.append(code);i+=1;continue
        h=re.match(r'^(#{1,6})\s+(.*)$',l)
        if h:
            level=len(h[1]); t=h[2]
            if level==1: out.append('<title>'+inline(t)+'</title>')
            else: out.append(f'<h{level-1} seq="auto">{inline(t)}</h{level-1}>')
            texts.append(t);i+=1;continue
        img=re.fullmatch(r'!\[([^\]]*)\]\(([^)]+)\)',l)
        if img:
            path=(src.parent/img[2]).resolve(); assert path.is_file(),path
            relative=path.relative_to(ROOT).as_posix()
            out.append(f'<img path="@./{esc(relative)}" width="540" caption="{esc(img[1])}"/>');imagecount+=1;i+=1;continue
        if l.startswith('|') and i+1<len(lines) and re.match(r'^\|[\s:|\-]+\|$',lines[i+1].strip()):
            def cells(row): return [c.strip() for c in row.strip().strip('|').split('|')]
            headers=cells(l);rows=[];i+=2
            while i<len(lines) and lines[i].strip().startswith('|'):
                row=cells(lines[i]);assert len(row)==len(headers),(headers,row);rows.append(row);i+=1
            n=len(headers);out.append('<table><colgroup>'+''.join('<col width="'+str(int(1000/n))+'"/>' for _ in headers)+'</colgroup><thead><tr>')
            out.extend('<th background-color="light-gray"><p>'+inline(c)+'</p></th>' for c in headers)
            out.append('</tr></thead><tbody>')
            for row in rows:
                out.append('<tr>');out.extend('<td><p>'+inline(c)+'</p></td>' for c in row);out.append('</tr>')
            out.append('</tbody></table>');tablecount+=1;texts.extend(headers)
            texts.extend(c for row in rows for c in row);continue
        if l.startswith('- '):
            out.append('<ul>')
            while i<len(lines) and lines[i].strip().startswith('- '):
                t=lines[i].strip()[2:];out.append('<li>'+inline(t)+'</li>');texts.append(t);i+=1
            out.append('</ul>');continue
        if re.match(r'^\d+\.\s',l):
            out.append('<ol>')
            while i<len(lines) and re.match(r'^\d+\.\s',lines[i].strip()):
                t=re.sub(r'^\d+\.\s','',lines[i].strip());out.append('<li>'+inline(t)+'</li>');texts.append(t);i+=1
            out.append('</ol>');continue
        out.append('<p>'+inline(l)+'</p>');texts.append(l);i+=1
    xml='\n'.join(out)+'\n';root=ET.fromstring('<document>'+xml+'</document>')
    assert len(root.findall('title'))==1
    dest.write_text(xml,encoding='utf-8')
    check=''.join(root.itertext());missing=[]
    for t in texts:
        expected=''.join(ET.fromstring('<p>'+inline(t)+'</p>').itertext())
        if expected not in check:missing.append(expected)
    assert not missing,missing
    report={'source':str(src),'draft':str(dest),'source_characters':len(src.read_text(encoding='utf-8')),'tables':tablecount,'whiteboards':diagram,'images':imagecount,'mermaid_blocks':codecount,'text_units_checked':len(texts),'missing_text_units':len(missing),'major_sections':[ ''.join(h.itertext()) for h in root.findall('h1')], 'xml_bytes':len(xml.encode('utf-8'))}
    if main:
        assert len(root.findall('h1'))==5
        assert diagram==4 and imagecount==3
        for pref,num in [('TC',32),('AI',12),('F',14),('D',6),('E',8),('BC',5)]:
            for k in range(1,num+1): assert f'{pref}{k:02}' in check,(pref,k)
        assert '老师' not in check and '5.29' not in check and '真实 PRD 模板' not in check
    dest.with_suffix('.build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
    return report

if __name__=='__main__':
    make_diagrams()
    convert(SRC,WORK/'draft.xml',main=True)
