---
name: 造物营
description: 以暖光、商品摄影和柔和立体层次组织商业创作的工作台。
colors:
  primary: "#bd4b16"
  primary-hover: "#a63c0b"
  accent: "#ff6a00"
  ink: "#292522"
  muted: "#736d66"
  secondary-text: "#736457"
  field-secondary: "#6e6258"
  paper: "#faf8f5"
  surface: "#fffdfa"
  border: "#e7e1da"
  warm-tint: "#fff0e5"
  selected-nav: "#ffede0"
  selected-nav-text: "#a84517"
  white: "#fff"
typography:
  headline:
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-.035em"
  title:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "'PingFang SC', 'Microsoft YaHei UI', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.8
  button:
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.5
  metadata:
    fontSize: "11px"
    fontWeight: 400
rounded:
  badge: "6px"
  segment: "7px"
  field: "8px"
  control: "10px"
  compact-card: "12px"
  editor-panel: "14px"
  card: "16px"
  dialog: "18px"
  hero: "24px"
spacing:
  tight: "8px"
  control: "10px"
  compact: "12px"
  card-gap: "16px"
  work-gap: "18px"
  panel: "20px"
  group: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "#fffdf9"
    textColor: "#5e5145"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "#9c441e"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  input:
    backgroundColor: "#fffefb"
    textColor: "#453c33"
    rounded: "{rounded.field}"
    padding: "10px 11px"
  nav-item:
    textColor: "#645b52"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  nav-item-current:
    backgroundColor: "{colors.selected-nav}"
    textColor: "{colors.selected-nav-text}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  status-pill:
    backgroundColor: "#f2ede6"
    textColor: "#786b5e"
    rounded: "{rounded.badge}"
    padding: "4px 9px"
  segmented-control:
    backgroundColor: "#eee9e2"
    rounded: "{rounded.control}"
    padding: "4px"
  catalog-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
---

# Design System: 造物营

## Overview

**Creative North Star: "暖光创作台"**

用暖白与浅暖灰承托商品摄影，用烧橙色明确下一步操作。实体面板、半透明导航和叠放的素材形成有前后关系的工作空间；柔和阴影与细小高光提供用户指定的苹果风层次。创意展示允许更丰富的空间感，编辑区域保持稳定、紧凑、可阅读。

动效说明位置、层级和状态：页面进入、卡片悬起、图片缩放、素材视差与弹窗展开各有分工。示例摄影明确标识为示例，不借装饰动画暗示真实生成进度或完成结果。琥珀精华与抹茶饮品是当前创意摄影示例；已退役的杯子素材不再充当默认创作。

本文件从最终样式层 `public/redesign.css` 及其继承的基础组件提取。用户已指定橙色、暖灰、立体层次与丰富动效；FORM seed `d66924d7` 仅记录本轮探索来源，不覆盖这些已确认约束。

**Key Characteristics:**

- 暖白底、深灰正文与烧橙主操作。
- 摄影素材、柔和投影与半透明表面共同建立层次。
- 轻微空间运动与清楚的静态选中状态并存。
- 从桌面完整导航到手机侧滑导航保留同一能力结构。

## Colors

色彩像自然光下的暖纸与陶土：橙色负责操作，暖灰负责组织，摄影内容保留自身的色彩。

### Primary

- **烧橙 / primary**：实色主按钮及其文字反白；悬停使用更深的 `primary-hover`。
- **鲜橙 / accent**：既有品牌强调色。亮橙家族用于标识与摄影周围的暖光细节，不承担小字号正文。
- **暖橙浅底 / warm-tint**：低强度强调表面；当前 CSS 保留历史变量名 `--blue-tint`，实际值已经是暖橙。
- **导航选中底与文字 / selected-nav、selected-nav-text**：用浅底和深色文字共同说明当前位置。

### Neutral

- **暖纸 / paper**：应用背景，承接面板与摄影。
- **瓷白 / surface**：项目卡、功能卡与编辑面板的实体表面。
- **炭灰 / ink**：主要文字。
- **暖灰 / muted**：通用辅助色；当前成组说明文字使用更深的 `secondary-text`，表单、审核和服务说明使用 `field-secondary`。
- **砂线 / border**：表单、区域分隔与次按钮的细边界。
- **白 / white**：主按钮文字和表面高光。

绿色用于实际可用或已确认状态，琥珀色用于等待与待配置状态；这些语义色不替代橙色品牌。摄影里的绿与琥珀色属于画面内容，不建立第二套品牌色。

**The Readable Orange Rule.** 小型主操作使用深烧橙搭配白字，亮橙留给品牌与装饰。

## Typography

**Body Font:** PingFang SC、Microsoft YaHei UI，随后按系统无衬线回退。

**Character:** 中文界面以清楚的字面和温和的字重差建立秩序。正文、表单与导航保持同一套字形；标题靠字号、字重和紧字距形成层级。

### Hierarchy

- **Headline**：常规页面标题；目录标题和编辑标题根据容器分别调整。
- **Title**：功能卡标题；章节标题稍大，编辑面板标题更紧凑。
- **Body**：说明和表单文字；长说明维持宽松行高，输入文字在手机提升到 16px。
- **Button**：主、次、轻操作共用的文字层级；按钮行高已经统一，保证纵向居中。
- **Metadata**：时间、版本、状态及较短的补充说明。此角色记录当前实现，不应扩展为所有正文的默认大小。

首页展示标题目前使用 `clamp(33px,3.35vw,57px)`、750 字重与 1.2 行高，并随断点调整。它仍沿用系统字族，尚未形成独立展示字体；这项缺口不作为未来展示字体的规范。

**The Task First Rule.** 标题说明任务，标签说明状态；装饰性眉题不进入共用标题层级。

## Layout

桌面采用完整左侧导航与右侧工作区。标准侧栏宽 220px，1250px 以下收为 190px；顶部栏固定在滚动容器顶端。常规内容最大宽度 1600px，标准横向留白 38px，大屏提升为 52px。组件间距以 8、12、16、18、20、24px 的实测节奏为主，不强制虚构统一倍数。

项目与功能目录通常使用三列卡片；1000px 以下切为两列。760px 以下保留两列紧凑目录与项目卡，场景入口改为单列；360px 以下目录和项目也改为单列。手机页面横向留白为 18px。

编辑器在桌面采用资料、画布、参数三栏，基础列宽为 238px / `minmax(240px,1fr)` / 248px，间距 18px。1250px 以下参数区移至整行；760px 以下按资料、画布、参数排列成单列。手机输入和需求文本域使用 16px 字号。

响应节点为 1600、1250、1000、760、360px。760px 以下导航成为 225px 宽的侧滑面板，隐藏时不可见，展开时配合模糊遮罩；完整功能入口仍在该面板中。

## Elevation & Depth

深度来自暖色阴影、实体表面、透明叠层和局部透视的混合。普通内容卡在静止时已有轻投影，悬停增加投影并小幅上移；编辑画布靠更深的背景与纸面阴影获得稳定边界。导航和浮动说明使用半透明白及背景模糊，透明材质不覆盖大段正文。

### Shadow Vocabulary

- **轻层 / elev-1**（`0 4px 12px rgba(65,39,17,.035),0 16px 36px rgba(65,39,17,.055)`）：卡片、面板、需求区的基础投影。
- **浮层 / elev-2**（`0 12px 25px rgba(62,37,14,.08),0 30px 65px rgba(62,37,14,.10)`）：可交互卡片悬停及可撤销操作提示。
- **模态层**（`0 20px 80px #3b240f3b`）：需要用户处理的弹窗，配合 7px 背景模糊。
- **摄影纸片**（`0 8px 12px #58341114,0 25px 45px #64411f25,0 1px 0 1px #ffffffa6`）：首页叠放素材的边缘与离地感。

**The Soft Lift Rule.** 卡片的升起、投影和摄影缩放共同表达可操作性，投影保持柔和，不把硬边偏移投影扩展到普通界面。

## Shapes

形态是有分工的柔和圆角：小状态标记最紧凑，输入框和按钮适中，实体卡片与编辑面板稍大，弹窗与主展示容器更宽舒。边界使用细线、浅色面或阴影，不给所有区域重复套上边框。

圆角值以 frontmatter 中的角色为准。摄影内容在卡片内裁切；首页主容器桌面使用 hero 圆角，手机收为 20px。图标容器可为小圆角方形，头像、帮助按钮和场景箭头使用圆形。选中项必须保留色块或边界，不能只靠空间位置表达。

## Components

### Buttons

主操作温和而明确。主按钮与原有 dark 变体共用烧橙；次按钮采用瓷白与细边界；轻操作以深橙文字融入背景。标准按钮最小高度 40px，悬停主按钮上移 2px、次按钮上移 1px；按下使用 1px 下移与 0.98 缩放。禁用状态为 0.55 透明度与不可用光标。

键盘焦点使用 `3px solid #bf5618` 外轮廓，向外偏移 4px。焦点与禁用状态属于组件必备状态，不能以阴影替代。

### Chips

状态标记采用紧凑圆角和清楚文字。普通状态为暖灰，已确认或可使用状态为柔和绿，等待状态为浅琥珀。分段选择器使用凹入的暖灰底、瓷白选中片与轻微投影；选中态在没有动效时仍清楚。

### Cards / Containers

项目、功能目录和设置卡共用瓷白底、卡片圆角与轻层投影。项目卡内文留白为 17px 18px，目录卡为 19px 21px，编辑面板为 20px。目录与场景卡悬停上移幅度为 4–7px，摄影缓慢放大；卡片信息区的阅读位置保持稳定。

### Inputs / Fields

输入框用暖白填充、砂色描边和 field 圆角。正常、悬停和焦点边线依次为 `#e5ddd4`、`#ccb6a0`、`#b87040`；占位文字采用 secondary-text。表单聚焦仍保留统一外轮廓，手机文字提升以支持阅读与输入。

### Navigation

导航由真实文字和线性 SVG 图标组成，当前页以浅橙底、深橙字和细微内高光识别。悬停移动 2px；手机展开以 450ms 进入，遮罩保留页面上下文。导航文字、计数与账户区域在平板和手机侧栏中保持完整。

### Layered Photography

琥珀精华和抹茶饮品使用摄影纸片叠放，前后纸片分别以 8° 和 −13° 静态角度建立构图，透视为 1300px。指针运动仅在非触摸且未开启减少动态效果时驱动轻微视差；离开后回到零倾斜。图片明确标注为创意示例。

页面进入为 550ms，卡片与图像交互通常为 400–850ms，素材首次进入为 1100–1250ms。共用缓动为 `cubic-bezier(.19,1,.22,1)`。减少动态效果时停止动画、过渡和视差，保留静态纸片角度及所有状态信息。

## Do's and Don'ts

### Do:

- **Do** 用暖纸背景、瓷白面板和深灰正文保持创作内容的可读性。
- **Do** 让烧橙主按钮、浅橙选中态和焦点外轮廓分别说明操作、位置和键盘焦点。
- **Do** 让柔和投影、层间遮挡和摄影裁切共同建立立体感。
- **Do** 为丰富动效保留完整的减少动态效果路径。
- **Do** 将示例、待配置、未提供、进行中和真实结果明确区分。

### Don't:

- **Don't** 把展示样张放进用户任务列表，或在空白创作中自动恢复退役杯子示例。
- **Don't** 用动效、成功色或示例卡暗示未完成的真实模型调用。
- **Don't** 用亮橙作为小字号正文，或回退已加深的辅助文字颜色。
- **Don't** 将遗留字符图标、装饰性眉题或系统展示字族视为需要继承的品牌组件。
- **Don't** 因手机导航折叠而移除用户需要的功能入口。
