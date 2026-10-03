from pathlib import Path
from html import escape

ROOT=Path(__file__).resolve().parent
BG='#F5F1EE'; INK='#1E2421'; GREEN='#08754C'; JADE='#2BA483'; PALE='#E0EDE6'; WHITE='#FFFFFF'; GRAY='#63716A'

class Board:
    def __init__(self,h,title,sub):
        self.items=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="{h}" viewBox="0 0 1680 {h}">', '<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L10 4 L0 8 z"/></marker></defs>',f'<rect x="0" y="0" width="1680" height="{h}" fill="{BG}"/>']
        self.text(64,74,title,40,bold=True);self.text(64,124,sub,24,color=GRAY)
    def text(self,x,y,value,size=25,color=INK,bold=False):
        lines=value.split('\n'); spans=''.join(f'<tspan x="{x}" dy="{0 if i==0 else size*1.5}">{escape(line)}</tspan>' for i,line in enumerate(lines))
        self.items.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{700 if bold else 400}" fill="{color}">{spans}</text>')
    def box(self,x,y,w,h,title,body='',fill=WHITE):
        self.items.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="20" fill="{fill}"/>')
        self.text(x+28,y+48,title,29,bold=True,color=GREEN)
        if body:self.text(x+28,y+95,body,24)
    def line(self,points):
        self.items.append(f'<polyline points="{points}" stroke="{GREEN}" stroke-width="3" fill="none" marker-end="url(#arrow)"/>')
    def save(self,name):
        (ROOT/name).write_text('\n'.join(self.items+['</svg>']),encoding='utf-8')

b=Board(920,'从创作需求到有效采用','北极星衡量用户获得的结果，质量、效率与成本解释结果如何形成')
b.box(370,180,940,150,'每周有效采用创作需求数','本周首次采用 · 至少一张仍被采用 · 按 task_id 去重',PALE)
for x in [95,640,1185]: b.line(f'840,330 840,380 {x+200},380 {x+200},425')
b.box(64,426,470,206,'有需求进入','有效创作需求数\n上传完成率 · 受理转化率\n正式用户与内部评测分开')
b.box(606,426,470,206,'产出可选择的方案','完整交付率 · 首轮可采用率\n商品事实与要求达标\n三方向视觉差异达标')
b.box(1148,426,468,206,'用户确认采用','逐图采用 / 拒绝 / 撤销\n关联图片与版本\n重复生成不重复计需求')
b.box(64,694,752,158,'效率与成本约束','首次展示耗时 · 人工修改时长\n实际账单成本 / 采用需求',PALE)
b.box(864,694,752,158,'质量保护','商品 / 需求 / 交付硬门槛\n构图 · 风格 · 融合 · 文字',PALE)
b.save('01-metric-tree.svg')

b=Board(1120,'数据采集与证据关联','需求、执行、图片版本各有标识；阶段事件用于定位，用户反馈用于采用统计')
xs=[64,398,732,1066]; w=286
for x,title,body in [(64,'上传与抠图','input_id\ninput_revision'),(398,'受理与规划','task_id → job_id\nprompt_version'),(732,'三方向生成','concept_id\nmodel / 耗时 / 错误'),(1066,'合成与保存','asset_id + version\n尺寸 / 文件 / 规则')]:b.box(x,190,w,170,title,body)
for a,c in [(350,398),(684,732),(1018,1066)]:b.line(f'{a},275 {c},275')
b.line('1352,275 1480,275 1480,420 1066,420 1066,470')
b.box(898,470,518,172,'展示、导出与采用','加载且可见才记录展示\n采用 / 拒绝 / 撤销保留历史')
b.box(64,470,690,172,'trace_id / span_id / execution_id','每次执行保留阶段耗时与失败位置\n重试沿用 task_id，新增 job_id',PALE)
b.line('520,360 520,470');b.line('930,360 930,420 550,420 550,470')
b.line('405,642 405,700 370,700 370,750');b.line('1155,642 1155,700 1120,700 1120,750')
b.box(64,750,700,224,'产品数据与质量中心','任务表 · 阶段事件 · 逐图反馈\n自动规则 · 人工评审 · Badcase\n按 production / evaluation 分开查询')
b.box(816,750,800,224,'Langfuse 与评测工具','过程追踪与独立评分关联 job / asset\n回填读回成功与持续自动导出分别验收\n不把接口成功、评分通过等同于采用')
b.text(64,1048,'原图与模型响应受控保存；日志只保留标识、版本、用量和脱敏错误。',25,color=GRAY)
b.save('02-telemetry-map.svg')

b=Board(1110,'评测与 Badcase 闭环','先检查交付，再检查事实与设计；每个结论关联输入、版本和证据')
b.box(64,184,450,185,'确定性检查','成品数量 / 文件 / 尺寸\n固定文案 / 输入边界')
b.box(606,184,450,185,'AI 辅助评审','非视觉评分：执行与文本\n视觉预审：图像问题定位')
b.box(1148,184,468,185,'人工视觉验收','商品 / 需求 / 交付门槛\n设计评分 + 采用判断')
b.line('514,273 606,273');b.line('1056,273 1148,273')
b.box(64,432,718,146,'评估器有争议','补充原图事实 → 人工复核 → 新版重评',PALE)
b.box(830,432,786,146,'产品出现问题','保存原始证据 → 建立 Badcase → 定位阶段',PALE)
b.line('830,369 830,397 420,397 420,432');b.line('1382,369 1382,432')
b.box(64,656,450,205,'归因','区分已证实事实与假设\n定位最早偏离预期的位置\n一条问题可关联多个复现')
b.box(606,656,450,205,'定向修复与回归','固定输入 / 模型 / 数量\n优先复用底图验证排版\n新版本保留前后证据')
b.box(1148,656,468,205,'关闭条件','原问题通过复验\n相邻场景没有严重退步\n当前版本人工确认')
b.line('1223,578 1223,610 289,610 289,656');b.line('514,755 606,755');b.line('1056,755 1148,755')
b.box(64,921,1552,116,'未通过回归 → 保持 investigating','修改归因、修复方案或图片版本后，旧的回归通过记录不能直接复用。',PALE)
b.save('03-evaluation-loop.svg')
print('Created 3 editable SVG boards')
