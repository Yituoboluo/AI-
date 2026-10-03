# Eval-Any-Agent 安装与使用说明

通用 Agent / 模型评测工具，支持数据集上传、请求模板、流式响应、批量任务、LLM 评估、定时任务和结果导出。

本机扩展（2026-09-30）：评估结果页已支持 **人工复核**，可查看本机图片证据，记录“判对了 / 判错了 / 暂时无法判断”及理由，保留修改历史并导出。使用方法见 [人工复核使用说明](E:/...AAAAIIIIIAIPM/个人项目/Eval-Any-Agent-source-20260929/Eval-Any-Agent/人工复核使用说明.md)。

## 交付内容与隐私

本包仅包含通用源码、部署配置和说明。不包含真实数据库、账号、API Key、机器人凭据、内部接口、业务数据集、历史结果、截图或 Git 历史。首次安装得到空白环境，需要自行上传数据集并创建接口配置和评估器。

`SHA256SUMS.txt` 为原上游版本的历史校验记录，部分文件已更新。核验本次交付请使用包根的 `文件清单_SHA256.json`。如包内存在 `eval-any-agent-image.tar`，它是从本包脱敏源码构建的 Linux AMD64 Docker 镜像，可离线导入；否则请联网构建镜像。

## 一、Docker 安装（推荐）

要求：Docker Engine / Docker Desktop 和 Docker Compose v2，建议至少 2 核 CPU、4 GB 内存。Windows 请将 Docker Desktop 切换至 Linux 容器。离线镜像适用于 x86_64 / AMD64 主机；其他架构请从源码构建。

### 1. 解压并准备配置

进入解压后的 `Eval-Any-Agent` 目录。不要从 ZIP 中直接运行命令。

Linux / macOS：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，必须设置 `AUTH_SECRET`、`SCHEDULER_SECRET` 和 `DEFAULT_ADMIN_PASSWORD`，不能使用示例占位值。两项密钥应分别使用至少 32 字符的随机值，例如使用密码管理器生成。管理员默认用户名为 `admin`。

默认只允许本机访问。如需在可信内网或 VPN 中共享，设置 `APP_BIND_ADDRESS="0.0.0.0"`，并在防火墙中限制访问来源。不要直接暴露到公网；跨网络访问应使用 VPN 或带 HTTPS 的反向代理。

### 2. 启动

有离线镜像时：

```bash
docker load -i eval-any-agent-image.tar
docker compose --env-file .env up -d --no-build --pull never
```

没有离线镜像时（需联网下载基础镜像与 npm 依赖）：

```bash
docker compose --env-file .env up -d --build
```

首次启动会自动初始化数据库和管理员。打开 `http://localhost:3000/login`，使用 `.env` 中的管理员账号和密码登录。远程访问时将 `localhost` 替换为服务器地址；若修改 `APP_PORT`，使用对应端口。

### 3. 状态、重启与停止

```bash
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
docker compose down
```

数据保存在命名卷 `app_data` 中，普通重启或 `down` 不会删除数据。不要执行 `down -v`，该命令会删除数据库。更新或迁移前请备份数据卷。已有数据库的密码不会随着 `.env` 的 `DEFAULT_ADMIN_PASSWORD` 改动而自动更新。

## 二、Node.js 源码安装（备选）

要求：Node.js 22 LTS、npm，并能联网下载依赖。将 `.env.example` 复制为 `.env` 并修改密钥和密码，方法同上；不要只创建 `.env.local`，Prisma CLI 默认读取 `.env`。

```bash
npm ci
npm run db:generate
npm run db:push
npm run db:seed
npm run build
npm run start
```

访问 `http://localhost:3000/login`。开发调试使用 `npm run dev`。源码运行时数据库位于 `prisma/dev.db`，生产运行建议使用服务管理器保持进程常驻。构建时需要联网获取依赖及字体。

## 三、配置与使用

1. **数据集**：选择 CSV / XLSX / XLS 文件，确认名称后点击上传。首行为列名；每行是一条 case。建议设置问题列和真值列，例如 `question`、`reference_output`。
2. **配置中心**：新建接口配置，填写自己的上游 URL、请求 Header、请求模板、输入绑定、输出提取和结束信号。默认接口是示例占位地址，必须替换。
3. **Dry Run**：先试一条，确认请求和响应提取正确，再创建批量评测任务。初次调试建议并发设为 2。
4. **评估器**：先创建兼容 OpenAI API 的模型配置，填写模型服务的 Base URL、API Key 和模型名；再创建评估器，配置真值、实际输出、评分标准及通过阈值。评测执行成功不等同于业务正确，业务结果需查看评估结果。
5. **评估结果**：选择已执行的评测任务和评估器，创建评估任务，查看分数、通过状态和原因，也可导出报告。手动创建评估时，钉钉通知默认关闭。
6. **定时任务**：选择数据集、接口配置和执行计划，使用 `Asia/Shanghai` 时区。每天 23:00 应填写 `0 23 * * *`。定时执行后会尝试自动使用当前用户最新更新的评估器评估，请先创建并确认评估器；没有评估器时无法自动打分。

请求模板示例（根据自己的接口协议调整）：

```json
{
  "msg": "{{msg}}",
  "sessionId": "{{sessionId}}",
  "stream": "true"
}
```

在输入绑定中，将 `msg` 绑定到数据集的问题列。会话字段应根据接口要求填写或配置会话 ID 策略，不要将不同 case 意外复用到同一会话。

## 四、钉钉通知（可选）

包内通知凭据为空，不会自动给任何已有群发送消息。自行创建机器人后，在 `.env` 填写 `DINGTALK_WEBHOOK`、`DINGTALK_SECRET`，再重建容器以应用环境变量：

```bash
docker compose --env-file .env up -d --force-recreate --no-build
```

源码方式部署时，修改 `.env` 后重启服务。手动评估在**评估结果**页面通过“发送钉钉通知”控制；定时任务有独立开关，默认开启。通知在评估完成后发送，不是在接口执行刚结束时发送。未配置机器人时不发送通知。

通知可能包含数据集名称、配置名称及失败 case 内容。向外部群发送前，请自行确认没有敏感信息。评测接口和评估模型同样会收到对应请求和待评分内容，务必使用授权的服务。

## 五、常见问题

- 无法打开页面：确认容器或 Node 进程在运行、端口未被占用；内网访问还需检查绑定地址、VPN 和防火墙。
- 接口全失败：先检查 URL、鉴权、请求模板和输入绑定，用 Dry Run 验证。
- 已执行但没有分数：确认评估任务已创建，模型配置有效，评估器已完成运行。
- 定时任务不执行：服务必须持续运行；检查启用状态、下一次执行时间、时区和计划表达式。
- 没收到钉钉：检查环境变量、通知开关、评估完成状态和机器人安全设置；不需要通知时关闭开关。
- 无法拉取镜像或依赖：联网源码构建需要可访问的容器及 npm 镜像源；有离线镜像时使用 `docker load`。

源代码按包内 `LICENSE` 分发。请勿将自己的 `.env`、数据库、真实评测数据或结果加入二次分发包。
