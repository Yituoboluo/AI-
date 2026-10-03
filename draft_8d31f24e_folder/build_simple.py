from pathlib import Path
import sys,json,html,xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path.cwd();WORK=ROOT/'draft_8d31f24e_folder'
sys.path.insert(0,str(ROOT/'draft_a3706042_folder'))
from build_skill_prd import convert

parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="490" viewBox="0 0 1050 490">',
       '<rect x="0" y="0" width="1050" height="490" fill="#ffffff"/>',
       '<text x="45" y="48" font-family="Noto Sans SC" font-size="28" font-weight="700" fill="#242424">一次图片创作</text>',
       '<text x="45" y="80" font-family="Noto Sans SC" font-size="18" fill="#5c5c5c">从原图开始，拿到文件后记录质量与使用意愿</text>']
nodes=[(170,143,'上传商品图','保留原图，预览抠图'),(525,143,'选择创作要求','一套或三套，方图或竖图'),(880,143,'生成不同方案','按实际进度展示结果'),(880,330,'比较与调整','选择方案，修改文字'),(525,330,'保存并下载','取回当前版本文件'),(170,330,'质量与采用','有问题先修正再检查')]
for i,(x,y,title,sub) in enumerate(nodes,1):
    parts.append(f'<circle cx="{x}" cy="{y}" r="28" fill="#fff3e8" stroke="#bb500e" stroke-width="1.5"/>')
    parts.append(f'<text x="{x}" y="{y+8}" text-anchor="middle" font-family="Noto Sans SC" font-size="24" font-weight="700" fill="#98400c">{i}</text>')
    parts.append(f'<text x="{x}" y="{y+65}" text-anchor="middle" font-family="Noto Sans SC" font-size="23" font-weight="600" fill="#242424">{html.escape(title)}</text>')
    parts.append(f'<text x="{x}" y="{y+96}" text-anchor="middle" font-family="Noto Sans SC" font-size="18" fill="#5c5c5c">{html.escape(sub)}</text>')
def arrow(points):
    ps=' '.join(f'{x},{y}' for x,y in points);parts.append(f'<polyline points="{ps}" fill="none" stroke="#6b6b6b" stroke-width="2"/>')
    x,y=points[-1];px,py=points[-2]
    p=f'{x},{y} {x-9},{y-5} {x-9},{y+5}' if x>px else f'{x},{y} {x+9},{y-5} {x+9},{y+5}' if x<px else f'{x},{y} {x-5},{y-9} {x+5},{y-9}'
    parts.append(f'<polygon points="{p}" fill="#6b6b6b"/>')
arrow([(205,143),(490,143)]);arrow([(560,143),(845,143)])
arrow([(915,143),(1000,143),(1000,330),(915,330)])
arrow([(845,330),(560,330)]);arrow([(490,330),(205,330)])
parts.append('</svg>'); svg='\n'.join(parts)
(WORK/'flow.svg').write_text(svg,encoding='utf-8');ET.fromstring(svg)
src=ROOT/'交付文档'/'造物营_PRD_精简图文评审版_V1.1.md'
report=convert(src,WORK/'draft.xml')
xml=(WORK/'draft.xml').read_text(encoding='utf-8')
old='<img path="@./draft_8d31f24e_folder/flow.svg" width="540" caption="图片创作主流程"/>'
assert xml.count(old)==1
xml=xml.replace(old,'<whiteboard type="svg" path="@./draft_8d31f24e_folder/flow.svg"/>')
xml=xml.replace('width="540"','width="900"')
(WORK/'draft.xml').write_text(xml,encoding='utf-8')
root=ET.fromstring('<document>'+xml+'</document>')
assert len(root.findall('h1'))==5
assert len(root.findall('table'))==1 and len(root.findall('img'))==3 and len(root.findall('whiteboard'))==1
assert not root.findall('pre')
report.update({'whiteboards':1,'images':3,'source_characters':len(src.read_text(encoding='utf-8')),'xml_bytes':len(xml.encode('utf-8'))})
(WORK/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
