from pathlib import Path
import json,re,sys,xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
work=Path.cwd()/'draft_8d31f24e_folder'
record=json.loads((work/'readback.json').read_text(encoding='utf-8-sig'));assert record['ok']
doc=record['data']['document']
actual=ET.fromstring('<document>'+doc['content']+'</document>')
expected=ET.fromstring('<document>'+(work/'draft.xml').read_text(encoding='utf-8')+'</document>')
norm=lambda s:re.sub(r'\s+','',s)
text=norm(''.join(actual.itertext()));units=[];missing=[]
for node in expected.iter():
    if node.tag in ['title','p','h1','h2','h3','li']:
        unit=norm(''.join(node.itertext()))
        if unit:
            units.append(unit)
            if unit not in text:missing.append(unit)
report={'document_id':doc['document_id'],'revision':doc['revision_id'],'text_units_checked':len(units),'missing_units':missing,'tables':len(actual.findall('.//table')),'images':len(actual.findall('.//img')),'whiteboards':len(actual.findall('.//whiteboard')),'code_blocks':len(actual.findall('.//pre')),'major_sections':[''.join(n.itertext()) for n in actual.findall('h1')]}
assert not missing,report
assert len(report['major_sections'])==5 and report['tables']==1 and report['images']==3 and report['whiteboards']==1 and report['code_blocks']==0
(work/'readback.xml').write_text(doc['content'],encoding='utf-8')
(work/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
