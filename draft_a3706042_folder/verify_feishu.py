from pathlib import Path
import json,re,sys,xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path.cwd()
reports=[]
for folder in ['draft_a3706042_folder','draft_5453e3e3_folder']:
    work=ROOT/folder
    record=json.loads((work/'readback.json').read_text(encoding='utf-8-sig'))
    assert record['ok']
    doc=record['data']['document']; actual=ET.fromstring('<document>'+doc['content']+'</document>')
    expected=ET.fromstring('<document>'+(work/'draft.xml').read_text(encoding='utf-8')+'</document>')
    def norm(t):return re.sub(r'\s+','',t)
    text=norm(''.join(actual.itertext())); units=[]; missing=[]
    for node in expected.iter():
        if node.tag in ['title','p','h1','h2','h3','h4','h5','li','code']:
            unit=norm(''.join(node.itertext()))
            if unit:
                units.append(unit)
                if unit not in text:missing.append(unit)
    report={'document_id':doc['document_id'],'revision':doc['revision_id'],'text_units_checked':len(units),'missing_units':missing,'tables':len(actual.findall('.//table')),'images':len(actual.findall('.//img')),'whiteboards':len(actual.findall('.//whiteboard')),'mermaid_blocks':len(actual.findall('.//pre')),'major_sections':[''.join(n.itertext()) for n in actual.findall('h1')]}
    if folder=='draft_a3706042_folder':
        assert report['tables']==60 and report['images']==3 and report['whiteboards']==4
        assert len(report['major_sections'])==5
        for pref,num in [('TC',32),('AI',12),('F',14),('D',6),('E',8),('BC',5)]:
            for i in range(1,num+1):assert f'{pref}{i:02}' in text
        assert actual.find(".//a[@href='https://my.feishu.cn/docx/DIUfd394noTTDIxLDJrcGSMxnFe']") is not None
    assert not missing,report
    (work/'readback.xml').write_text(doc['content'],encoding='utf-8')
    reports.append(report)
(ROOT/'draft_a3706042_folder'/'feishu-verification.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(reports,ensure_ascii=False))
