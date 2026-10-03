# 造物营个人项目

GitHub 入口：[主产品源码与开发说明](material-studio/README.md) 位于 `material-studio/`。使用 Node.js 24，在仓库目录执行：

```bash
cd material-studio
npm ci
npm run dev
```

[完整交付 ZIP（约 194MB）与校验文件](https://github.com/Yituoboluo/AI-/releases/tag/delivery-20261003) 位于 Release。包内打包说明适用于 Release 文件；仓库构建产物需在 `material-studio/` 中运行 `npm run build` 生成。

2026-10-02 评审入口：[飞书PRD精简图文评审版](https://my.feishu.cn/docx/VrUXdCVclooqyTxtT8Tc5x0SnLe)。正文约3500字，以自然语言说明目标、范围、流程、关键规则与验收，配现有界面、主流程图和真实生成／问题样例；已读回核对。[本地备份](交付文档/造物营_PRD_精简图文评审版_V1.1.md)。原完整稿继续用于查询技术细节。

2026-10-01 当前文档交付：按 pm-master → pm-prd-writer 重新生成并创建[飞书 PRD 完整评审版](https://my.feishu.cn/docx/PJe2dvUFBoZDwgxItzicypzWnef)和[独立待确认项](https://my.feishu.cn/docx/DIUfd394noTTDIxLDJrcGSMxnFe)。标准五章，包含图片主流程、12条AI规则、32条验收用例、最新评测和作业证据；飞书正文已读回核对。另保留[本地Markdown备份](交付文档/造物营_PRD_Skill标准版_V1.0.md)。29张产品视觉评审、12条评分正式复核与真实问题回归仍待执行。

当前状态：核心图片创作与质量管理已上线；首轮真实链路和非视觉模型评分已完成，进入评分复核、质量修复与人工验收阶段。最近补充复核：2026-09-30 19:00，北京时间。

2026-09-30 补充：评测结果页已增加可保存的 **人工复核** 入口，支持原图/成品对照、判断与理由、历史和导出。正式 12 条结果仍待实际复核；[打开复核页面](http://127.0.0.1:3000/dashboard/evaluation-tasks/cmunznt6d001zbxi8x06xa07u/results)（需要在原本机服务和数据环境下访问） · [使用说明](Eval-Any-Agent-source-20260929/Eval-Any-Agent/人工复核使用说明.md)。

先看 [项目总览与进度盘点](项目总览.md)，再看 [最新真实评测报告](outputs/real-eval-20260930/真实评测报告.md)。

最新结果：12 个独立场景执行完成；10 个生图场景中 9 组完整、1 组部分交付，保存 29 张成品；2 个边界检查通过。5 条真实问题均待处理，人工评分 0，修复回归 0。完整交付率 90% 不能替代采用率或商用可用率。

| 入口 | 内容 |
| --- | --- |
| [评审PRD（精简图文版）](https://my.feishu.cn/docx/VrUXdCVclooqyTxtT8Tc5x0SnLe) | 五部分自然语言正文、1张验收表、工作台截图、主流程图及真实样例；当前评审阅读入口 |
| [交付 PRD（飞书）](https://my.feishu.cn/docx/PJe2dvUFBoZDwgxItzicypzWnef) | Skill标准五章完整评审版；[待确认项（飞书）](https://my.feishu.cn/docx/DIUfd394noTTDIxLDJrcGSMxnFe)；[本地Markdown备份](交付文档/造物营_PRD_Skill标准版_V1.0.md) |
| [项目总览](项目总览.md) | 全目录职责、进度变化、完成度口径与下一步优先级 |
| [线上造物营](https://material-studio-demo.changfangzhen4.chatgpt.site) | 当前 PC 工作台，V14 已发布 |
| [主产品源码](material-studio/README.md) | 仓库内主产品源码与开发说明 |
| [真实评测报告](outputs/real-eval-20260930/真实评测报告.md) | 本机版本 A、12 场景、29 成品、5 条问题 |
| [新评分复核](outputs/real-eval-20260930/新评估结果复核_非视觉v1.md) | 非视觉评分 12 条，原始 9 通过、3 未通过；C08/C09 事实判定需复核 |
| [PRD 与作业差距](PRD与作业交付差距清单.md) | 最新飞书正文与课程原话对照、文档和验收剩余工作 |
| [真实评测看板](outputs/real-eval-20260930/真实评测看板.html) | 逐例成品、耗时与问题；[本机预览](http://127.0.0.1:4174/)（需要在原本机服务和数据环境下访问） |
| [最新评测工具任务](http://127.0.0.1:3000/dashboard/tasks/cmuny0px80013bxi8791t27qt/results)（需要在原本机服务和数据环境下访问） | 标题边界校准后的证据汇总任务 |
| [本机质量中心](http://127.0.0.1:4173/#quality)（需要在原本机服务和数据环境下访问） | 选择“内部评测”查看本批反馈与 Badcase |
| [素材](素材) | 70 张商品与参考图片、1 个 PSD |
| [视觉产物与研究](output) | 概念图、场景融合样例、品类研究、历史部署包 |
| [原评测交付](outputs/01a0ede6-c7e3-7563-9c6c-d453396ca4bd) | 原方案、取样、两套 20 条用例与 A/B 模板，尚未回写新批次 |
| [本机评测工具](Eval-Any-Agent-source-20260929/Eval-Any-Agent) | Eval-Any-Agent 源码与运行副本 |
| [工具部署说明](Eval-Any-Agent-source-20260929/Eval-Any-Agent/本机部署.md) | 本机访问、启动与停止 |
| [文档制作档案](draft_b54b6272_folder) | 飞书文档 XML、提交与回读记录 |
| 技术工作记录（原本机 `.work/`） | 接入、执行、导入与审计记录仅保留在原本机，未纳入此仓库 |

下一步优先：修复商品裁切与背景约束问题，完成 29 张人工评审，再做同条件版本 B 回归；排版与裁切可先复用已有底图。核验运行中的 Langfuse 自动导出配置与线上质量链路。

本批是本机真实模型评测，云端质量表仍为空。10 个任务的 Langfuse 历史回填已读回，但本机运行接口仍显示自动导出未配置。评测工具的 24 条结果由真实执行和证据重放各 12 条组成，不代表 24 个独立场景或第二轮付费生成。

平台 12 个入口中 5 个标记可用，7 个仍为框架；本批主要覆盖食品饮料图片。原用例与新批次 ID 应连同批次名识别。output 中 TAR 为部署产物，开发请使用上表主源码。
