import fs from 'node:fs/promises';
const root='E:/...AAAAIIIIIAIPM/个人项目';
const dir='draft_b54b6272_folder';
const output='outputs/01a0ede6-c7e3-7563-9c6c-d453396ca4bd';
const cases=(await fs.readFile(`${root}/${output}/评测集_v0.1.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const p=x=>`<p>${esc(x)}</p>`;
const h=(x,n=1)=>`<h${n} seq="auto">${esc(x)}</h${n}>`;
const ul=xs=>`<ul>${xs.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
const ol=xs=>`<ol>${xs.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>`;
const table=(headers,rows,widths)=>`<table><colgroup>${widths.map(w=>`<col width="${w}"/>`).join('')}</colgroup><thead><tr>${headers.map(x=>`<th background-color="light-gray">${p(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td vertical-align="top">${p(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const board=name=>`<whiteboard type="svg" path="@./${dir}/${name}.svg"></whiteboard>`;
const sections=[];
sections.push('<title>造物营｜指标体系、埋点方案、评测集与 Badcase 实施计划</title>');
sections.push(p('个人项目评审材料 · 2026-09-30 · 准备版本 v0.1'));
sections.push('<callout background-color="light-orange"><p><b>当前进度</b>：指标与埋点方案已整理；70 张素材已清点，16 张真实输入已选定；20 条评测用例和评分模板已设计。本轮真实模型评测、产品改进和回归尚未执行。文中的对比方法与验收标准属于计划，未填写虚构效果数据。</p></callout>');
sections.push(p('这份材料用于说明：产品怎样创造价值、如何记录使用过程、怎样判断生成质量，以及发现问题后如何定位和验证改进。老师可按“指标 → 埋点 → 评测 → Badcase → 回归”的顺序检查。'));

sections.push(h('项目目标与本轮交付'));
sections.push(p('造物营是一款面向电商设计师和商家运营的 PC 图片创作工作台。用户放入商品图，可选背景、文案与排版约束，系统生成多个视觉样稿，用户挑选、调整并导出。当前优先解决同一商品的多方向探索，后续再扩展到不同 SKU 套图。'));
sections.push(p('项目价值：缩短从商品素材到“值得继续采用的设计方向”的时间。一次有效产出需要商品准确、符合需求、设计完整、文件可用，并获得设计者采用。这里的采用属于设计生产环节，暂不代表素材已经投放或带来销售转化。'));
sections.push(table(['检查项','已有基础','本轮交付标准'],[
 ['业务链路','代码已有上传、抠图、生成、合成、保存与导出流程','至少 1 条真实运行或失败记录，能够关联输入、job 与原始结果'],
 ['指标与埋点','已有任务状态和部分反馈、导出记录','指标分子分母清楚，事件触发与字段有定义；新增埋点仍需开发'],
 ['评测集','70 张原始素材中已选 16 张，设计 20 条用例','优先完成 8 个视觉任务首轮；留出调试与验收，评分可复核'],
 ['Badcase','已有用户反馈、静态代码缺口和保存失败 MOCK 演练','至少 1 页有原始证据的复盘；模拟单列，回归有结果才关闭']
],[150,360,510]));
sections.push(p('角色分工：项目作者确认商品事实、设计要求和最终采用判断；Codex 协助代码检查、日志整理、计算与复盘编排；老师检查方法和证据。评测付费预算、真实任务输出以及第二评审人尚未确定，影响执行规模。'));

sections.push(h('指标体系：以采用价值为主线'));
sections.push(board('metrics'));
sections.push(h('北极星与离线核心',2));
sections.push(p('北极星：每周获得采用的创意任务数。按北京时间自然周，统计该周首次出现有效采用的逻辑任务数。有效采用必须关联保存成功的具体图片和版本。一次商品与设计需求对应一个 task_id；失败重试产生新 job_id，沿用 task_id。开发、模拟与内部评测排除在正式用户周指标之外。'));
sections.push(p('当前离线核心：首轮可采用任务率 = 首轮至少一张可采用样稿的任务数 ÷ 本批全部有效已执行视觉任务数。模型或保存失败计入分母；缺日志不能被静默剔除。未评审和证据缺失单列，全部完成判定后才发布最终比率。'));
sections.push(p('目前的数据仅支持局部观察：现有反馈是整组最新状态，指标接口按最近 60 条快创任务汇总，不能直接当作一周全量北极星指标。先测基线，再制定质量与效率目标。'));
sections.push(table(['指标','计算口径','数据与使用边界'],[
 ['每周采用任务数','本周首次有效采用的 task_id 去重数','关联 asset_id 和版本；排除测试/模拟；撤销采用保留历史'],
 ['首轮可采用任务率','首轮至少一张可采用的任务 / 全部有效已执行视觉任务','失败计分母；待评不等于拒绝；同时报告样本数'],
 ['端到端交付成功率','受理后在测试窗口内全部候选保存并可读取的任务 / 已受理任务','本轮窗口暂定 10 分钟，执行前冻结；部分交付单列'],
 ['商品事实错误率','商品外观、颜色、文字、规格或数量出错图片 / 已完成人工事实检查图片','同时报告事实检查覆盖率；错误图片不进入采用'],
 ['组内视觉差异达标率','差异评审通过的组 / 已完成差异评审的组','场景、构图、配色、信息层级至少两项实质变化；报告覆盖率'],
 ['首次可用结果耗时','服务端受理到客户端首次确认可读取结果的秒数','报告 P50/P90 与计时样本量，失败率另列；不能只用模型响应时间'],
 ['每个采用任务成本','同一批任务全部调用、重试、失败与存储成本 / 获得采用的任务数','无采用时单位成本不可计算；实际账单与估算分开'],
 ['导出请求转化率','至少一次请求导出的已展示任务 / 已展示任务','当前已有部分事件；不能证明下载落盘、实际采用或投放'],
 ['人工评审覆盖率','全部图片评完的可交付任务 / 已可交付任务','技术失败另列；避免只评价好看的结果'],
 ['设计任务节省时长','同类任务人工工时 − AI 辅助总工时','AI 工时包含等待、修改与重试；需相同交付要求的人工对照']
],[180,410,430]));
sections.push(p('阈值说明：本轮先建立真实基线，不预填“采用率 80%”“效率提升 50%”等目标或成果。小样本优先同时呈现分子与分母，例如“3/4 个任务”，不只呈现百分比。'));

sections.push(h('埋点方案与 Trace 链路'));
sections.push(board('events'));
sections.push(p('埋点用于统计发生了多少次，Trace 用于解释某一次为什么失败。初期可以复用现有 generation_jobs，并增加结构化阶段记录，无需先引入复杂数据平台。以下事件为实现方案，除明确标注已有部分的项目外，仍需开发。'));
sections.push(table(['事件','触发位置','关键字段','当前情况'],[
 ['product_input_ready','客户端：上传完成并取得可用引用','input_revision、image_hash、尺寸、upload_source','待新增'],
 ['cutout_completed','客户端：抠图结束，成功失败都记录','模型版本、duration_ms、outcome、error_code','待新增阶段数据'],
 ['generation_accepted','服务端：校验通过并建立 job','task_id、job_id、options_snapshot、requested_count','已有 job，待补字段'],
 ['creative_plan_completed','服务端：结构化策略校验完成或失败','span_id、prompt_version、strategy_ids、schema_valid、fallback_reason','待新增阶段记录'],
 ['image_generation_completed','服务端：模型返回结果或明确失败','concept_id、model、provider_request_id、latency_ms、usage','待新增阶段记录'],
 ['asset_persisted','服务端：成品保存且可读取后','asset_id、version、storage_ref、dimensions、checksum','已有合成保存流程，待补逐图事件'],
 ['result_viewed','客户端：图片加载成功并进入可见结果区','asset_id、version、job_id、display_ms','待新增'],
 ['asset_feedback_saved','服务端：采用/拒绝/撤销成功保存后','asset_id、version、feedback、reason_code、edit_level','当前只有整组最新反馈，需逐图历史'],
 ['export_requested','服务端：接受导出请求','job_id、asset_id、version、output_index、格式','已有 quick_export_requested 部分记录'],
 ['generation_failed','服务端：不可恢复失败收敛为终态','failed_stage、error_code、retryable、provider_request_id','已有 job 错误，需补阶段'],
 ['retry_requested','服务端：用户重试被受理','task_id、new_job_id、parent_job_id、resume_stage','需补尝试关联；不增加逻辑任务数'],
 ['group_diversity_reviewed','人工：整组视觉差异评审保存后','job_id、evaluator、rubric_version、distinct_axes、verdict','本轮先记录在工作簿']
],[220,250,350,200]));
sections.push(h('公共字段、去重与完整性',2));
sections.push(ul([
 '任务关系：task_id 对应商品与需求；job_id 对应一次尝试；asset_id + version 对应具体输出图。相同请求使用幂等键，重放不新增付费任务。',
 '阶段关系：trace_id 串联整次执行，初期可等于 job_id；span_id 对应单个模型/处理步骤，parent_span_id 记录依赖。',
 '版本冻结：input_revision、model_version、prompt_version、layout_version、workflow_version、eval_version，用于复现与同条件对比。',
 '采集字段：event_id、occurred_at、received_at、environment、is_simulated、匿名会话与脱敏用户标识。重传按 event_id 去重。',
 '模型返回图片 URL、保存成功、用户看见是不同阶段。导出请求也不能证明文件已落盘或已投放。',
 '日志不写密钥和图片 base64；原始图、脱敏响应和输出用受控存储引用关联。失败、回退与晚到结果都保留。'
 ]));
sections.push('<pre lang="json" caption="字段结构示例，明确为模拟记录"><code>'+esc(JSON.stringify({task_id:'example-task',job_id:'example-attempt-1',is_simulated:true,input_revision:1,workflow_version:'proposed-v1',stages:[{name:'plan',status:'succeeded',prompt_version:'plan-v1'},{name:'generate',status:'succeeded',output_ref:'mock://generated'},{name:'persist',status:'failed',error_code:'STORAGE_WRITE_FAILED'}]},null,2))+'</code></pre>');

sections.push(h('评测集与人工评分'));
sections.push(p('素材已清点 70 张，主要是乳品单品和多件组合，也包含成品广告图和附加 SKU 文字图。本轮选择 16 张原始白底输入，记录文件路径、尺寸与 SHA-256。普通 P0 输入排除额外宣传排版、人物海报。图片数量与规格已从图像和文件名初步核对，最终商品事实由项目作者确认。'));
sections.push(p('评测集共 20 条：12 条常规视觉任务、4 条视觉边界任务、4 条工程链路用例。当前均为已设计、未执行。优先运行 C01–C08，每任务约定 2 张；C01–C04 调试，C05–C08 验收。工程模拟单列，不进入真实视觉效果指标。'));
sections.push(table(['用例与分组','输入及任务','预期与检查点'],cases.map(c=>[
 `${c.case_id} · ${c.split} · ${c.priority}`,
 `${c.input_requirement}。${c.brief}`,
 `${c.expected}。${c.checks}`
 ]),[150,420,450]));
sections.push(h('对比协议',2));
sections.push(ol([
 '冻结每条输入：原图、真实事实、需求、尺寸、背景/文案约束、产出张数，保存哈希。A 为当前实现，B 为一次明确改进。',
 '先保存 A 的首轮输出再修改。A/B 保持同输入、模型、分辨率和候选数；失败与重试单列，不能挑最好一轮代替首轮。',
 '用 C01–C04 调整；冻结 B 后再运行 C05–C08。查看验收结果后继续调参会污染验收集，需要换新案例或改称调试。',
 '评审时打乱顺序、尽量隐藏版本。项目作者做采用判断，可请老师或同学复核分歧；单人评审如实写。',
 '4 个验收案例只能形成探索性结论。素材集中于乳品，不外推到所有电商品类，不宣称统计显著或线上广告收益。',
 '批量执行前设调用预算和停止条件。32 张合成图不等于 32 次付费生图，费用取决于实际工作流。'
 ]));
sections.push(h('采用门槛与评分锚点',2));
sections.push(table(['维度','0 分/失败','1 分','2 分'],[
 ['商品事实（硬门槛）','外观、Logo、规格数量出错，或新增未经确认的功效/价格','不参与加总','必须合格'],
 ['需求与交付（硬门槛）','违反自定义约束、尺寸错误、无法读取导出、关键部分缺失','不参与加总','必须合格'],
 ['层次构图','主次混乱、布局明显不合理','信息完整，但较普通','焦点、留白、信息层级有意图'],
 ['风格贴合','不符品类或任务要求','基本合适，但较通用','色彩、材质和氛围服务于需求'],
 ['合成光影','破边、漂浮、透视或光源冲突','基本自然，有小瑕疵','边缘、阴影、透视与光源协调'],
 ['文字可读','溢出、遮挡或难辨','可读，但层级普通','对比清楚、层级与换行合理']
 ],[180,320,230,290]));
sections.push(p('试行采用规则：硬门槛全部合格，4 个设计项各至少 1 分、总分至少 6/8，再由评审人选择“可直接采用 / 小改后采用 / 需重做”。小改暂定为 10 分钟内的文字、颜色或局部位置调整，不含重新抠图、找背景或重做版式。过线不强迫采用；门槛不满足却选择采用需复核。'));
sections.push(p('组内差异单独判断：背景场景、构图、配色、信息层级至少两项有实质变化。同背景只换左右位置通常不通过；用户明确要求极简时，留白本身不算错误，应看构图和光影。'));

sections.push(h('Badcase 复盘与归因'));
sections.push(board('loop'));
sections.push(p('每条复盘保留八项：业务任务、预期、实际输出、影响指标、证据、归因假设、修复、回归结论。沿“需求 → 输入 → 策略 → 生图 → 合成 → 保存 → 展示 → 评价标准”寻找首个偏离阶段。评价器或评分规则错误，也可能造成误判。'));
sections.push(h('BC01：视觉方向趋同',2));
sections.push(table(['项目','记录'],[
 ['来源与现象','用户反馈生成结果是灰色空背景、固定字体和版式，缺乏设计感。尚未关联具体 job、原始输出与版本。'],
 ['预期与指标影响','同一商品给出两份完整且有明显差异的样稿；若无图可采用或组内差异不达标，分别影响首轮采用率与差异达标率。'],
 ['已确认的代码事实','策略限制连续背景与空桌面；回退为浅灰米白背景；同一背景生成两种主要位置；文字样式固定。'],
 ['待验证假设','策略限制与渲染规则压低设计层次和差异。需查看该次规划结果与背景原图，不能直接认定回退触发或模型能力不足。'],
 ['修复方向','先检查策略参数到画布的映射，再明确两份设计 brief，分别生成与合成。先保持模型和候选数不变。'],
 ['回归与状态','C01–C04 调试，C05–C08 验收，并保护 C04 极简场景。当前待关联真实输出，改进与回归未执行。']
 ],[200,820]));
sections.push(h('BC02：策略字段未映射到画布',2));
sections.push(p('静态检查发现规划输出 textColor，但合成器文字使用固定深色。这是确认的实现缺口，尚不是某张图片的已证实质量故障，更不是故障发生率。固定背景与文案，覆盖深浅背景、长标题和 3:4 尺寸，先做无需模型的渲染对比；以截图和可读性结果验证修复。当前回归待执行。'));
sections.push(h('BC03：生图成功但成品保存失败',2));
sections.push(p('已有 Badcase 页面提供 MOCK 保存失败演练。模拟链路为“模型产出成功 → 存储失败 → 无法交付”，用于展示按阶段记录与恢复保存。它不能证明真实线上故障的根因或发生率。'));
sections.push(p('排查所需证据：provider_request_id、原始输出引用、存储错误码、重试路径。回归需同时验证恢复保存、文件可读取、生图调用数不增加，并检查幂等和旧版本不覆盖新结果。当前演练框架存在，真实生产结论未建立。'));
sections.push(p('归因原则：把确定事实、待验证假设和模拟条件分开。修复后复跑同一失败案例与相邻场景，记录实际变化；证据不足或回归未跑时保持待验证，不写“已修复”。'));

sections.push(h('18 小时执行顺序与退出条件'));
sections.push(p('以下为用户提出检查期限时的相对时间预算，不因本文档创建而重新计时。已完成准备项直接跳过；进度落后时缩小执行规模，保留最后的整理与休息时间。'));
sections.push(table(['时间段','交付物与负责人','退出条件'],[
 ['T+0–2h','指标与规则冻结，选 8 个任务。Codex 整理，作者核对事实。','方案、模板与素材已准备；商品事实和具体 brief 待确认'],
 ['T+2–4h','一条真实任务与最小日志关联。Codex 检查技术，作者设预算。','输入、任务和输出/失败证据齐全；未跑通则进入降级方案'],
 ['T+4–7h','A 版 8 条首轮。Codex 记录，作者逐图评分。','16 张成品或完整失败证据；所有样本完成判定'],
 ['T+7–10h','选一个问题改进。Codex 实现，作者确认方向。','改动范围和版本明确；不同时换模型、张数与评判标准'],
 ['T+10–12h','B 版对比与工程演练。Codex 记录，作者盲评。','同条件验收与一次回归；真实与模拟分开'],
 ['T+12–14h','完整 Badcase 复盘。Codex 编排，作者核对。','一页真实问题证据与结论，加一条明确 MOCK 的演练'],
 ['T+14–15h','5 分钟讲述与追问。作者口述，Codex 模拟评审。','能解释指标分母、评分理由、归因证据与局限'],
 ['T+15–18h','缓冲、休息、补证据与冻结版本。','材料可打开，演示输入可定位，备用说明可复述']
 ],[130,480,410]));
sections.push(p('关键路径：输入与评分标准冻结 → A 首轮 → 有证据的问题 → 单点改进 → B 回归 → 复盘。指标口径、事件字典和工程 MOCK 可与素材准备并行；真实评审是必须由作者投入的瓶颈。检查是否达标由作者对照上述退出条件自验，老师在项目检查时复核。'));
sections.push('<callout background-color="light-orange"><p><b>降级触发</b>：到 T+4h 仍无法完成真实链路，作者决定缩小范围。保留真实失败记录，用已有输出做人工基线，完成指标/埋点设计和 MOCK 演练；真实效果与改进结果明确待验证。每条案例在约定窗口结束后收敛状态，停止无上限重试。</p></callout>');
sections.push(p('最低交付：指标表、埋点字典、20 条已设计用例、至少 1 条真实运行/失败证据、1 页真实问题分析、1 条 MOCK 演练。争取交付：8 条 A 与 8 条 B 的评分和回归。任何模型、输入、评分规则或候选数改变，都记录新版本并重新判断结果是否可比。'));

sections.push(h('向老师展示与填写入口'));
sections.push(ol([
 '40 秒：用户是谁、哪项设计任务、当前聚焦同商品多方向探索。',
 '50 秒：北极星与离线指标的区别，分子、分母和排除规则。',
 '70 秒：同一输入的样稿和逐图评分；哪些已经执行，哪些仍是计划。',
 '80 秒：从 Badcase 沿 Trace 找到偏离阶段，区分事实与假设。',
 '60 秒：改动、同条件回归、样本局限和下一步；未完成的部分如实说明。'
 ]));
sections.push(p('工作簿填写顺序：评测集确认素材与需求 → 运行记录填 job、状态与证据 → 图片评分逐张判断 → 补组内差异 → 查看汇总。浅黄色为输入区域，公式区自动计算。模板预留 A/B 各 20 条首轮记录和 64 张图片评分位；不以重复尝试覆盖首轮。'));
sections.push(`<source path="@./${output}/造物营_指标埋点评测与Badcase.xlsx" name="造物营_指标埋点评测与Badcase.xlsx"/>`);
sections.push(`<source path="@./${output}/评测集_v0.1.jsonl" name="评测集_v0.1.jsonl"/>`);
sections.push(h('证据来源与未关闭缺口',2));
sections.push(ul([
 '代码依据：本地快照 e534ba46a7c18522d7439ca29f7bd424bc780042；server/providers.mjs、public/quick-images.js、server/worker.mjs、db/schema.ts、public/badcase.js。本次文档制作未修改产品。',
 '素材依据：作者提供的“个人项目/素材”目录，已清点 70 张图片并选择 16 张输入；输入哈希见附件评测集。',
 '方法依据：此前录音分析《产品指标到 badcase》的指标—埋点—Trace—评测—归因—回归方法。本项目评分锚点与用例为新制定方案，并非课程实验数据。',
 '未关闭：真实模型调用与预算、完整阶段日志、逐图线上历史反馈、真实周指标、人工评分和回归结果。已有框架不代表以上能力全部上线。'
 ]));
await fs.writeFile(`${root}/${dir}/draft.xml`,sections.join('\n'),'utf8');
console.log(JSON.stringify({xml:`${dir}/draft.xml`,sections:sections.length,cases:cases.length,whiteboards:3,attachments:2}));
