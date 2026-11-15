# 任务管理工作台（含云同步）

一个**本地优先、支持多端云同步**的任务管理工具，集「记事本 + 备忘录 + 甘特图」于一体。
客户端是**网页应用（可安装到桌面 PWA）**，服务端是**零第三方依赖的 Node 程序**。

```
task-sync/
├── server.js               # 同步服务端（注册/登录 + 任务同步 + 静态托管）
├── public/                 # 前端（登录 + 任务管理 + 同步 + 离线）
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icon-192.png / icon-512.png
├── Dockerfile              # 容器镜像（自托管 / 云托管通用）
├── docker-compose.yml      # 一键 Docker 自托管
├── render.yaml             # Render 免费云部署配置
├── fly.toml                # Fly.io 部署配置
├── start.bat / start.sh    # 本地一键启动脚本
└── scripts/make_icons.py   # 图标生成脚本（可忽略）
```

## 一、功能

- **任务**：添加 / 编辑 / 删除，标题、描述、状态、优先级、起止日期、进度、标签。
- **时间排布**：甘特图（日/周/月缩放 + 今天标记 + 逾期高亮）、日历（月视图）。
- **查看**：看板（未开始/进行中/已完成）、列表（搜索/筛选/排序）。
- **记录**：每个任务多条带时间戳的工作记录。
- **归档 / 统计**：完成任务归档、恢复、清空；统计面板。
- **云同步**：登录账号后，多台设备数据自动同步（按任务更新时间合并，后改的覆盖先改的）。
- **离线可用**：未登录时纯本地使用；登录后断网也能继续编辑，联网后自动同步。
- **备份**：导出/导入 `.json`；PWA 可安装到桌面；深色主题。

## 二、快速开始（本地体验，最快）

> 需要本机装有 Node.js（18 及以上，推荐 20/22 LTS）。
> 下载：https://nodejs.org

```bash
cd task-sync
node server.js
```

然后浏览器打开 <http://localhost:8000> 即可。第一次使用点「登录 / 注册」创建账号。
Windows 用户也可以直接双击 `start.bat`。

## 三、多端云同步怎么用

核心思路：**把服务端部署到一台“一直在线”的机器/服务器上**，其它设备用浏览器访问它并登录同一账号即可。

- 登录后，右上角会显示「已登录：你的用户名」和「上次同步时间」。
- 每 60 秒自动同步一次；也可以点「↻ 同步」手动同步；断网时会保留本地修改，联网后自动补传。
- 换一台设备：打开同一个网址 → 登录同一账号 → 数据自动拉下来。

> 同步策略是「按任务更新时间的后写覆盖」。两个设备同时改**同一条**任务时，以最后保存的为准；不同任务互不影响。

## 四、部署方案 A：自己托管（数据完全归你）

适合有一台能长期开机的电脑 / 树莓派 / 云服务器 / NAS 的人。

### A1. 直接跑（需装 Node）

```bash
cd task-sync
node server.js          # 监听 0.0.0.0:8000
```

- 数据存在 `./data/data.json`。
- 环境变量：`PORT`（端口，默认 8000）、`DATA_DIR`（数据目录，默认 ./data）、`HOST`（默认 0.0.0.0）。
- 其它设备访问：`http://<这台机器的局域网IP>:8000`。
- 想从外网访问，需要在路由器做端口映射或用内网穿透（如 frp、Tailscale、Cloudflare Tunnel）。

### A2. 用 Docker（推荐，免装 Node）

```bash
cd task-sync
docker compose up -d --build
```

- 数据持久化在 Docker 卷 `task_data` 中，重启不丢。
- 更新数据位置：改 `docker-compose.yml` 里的 volume，可映射到宿主机目录，例如 `./data:/data`。

## 五、部署方案 B：云托管

> 🇨🇳 **国内推荐：阿里云轻量应用服务器**（速度快、稳定，新用户约几十元/年）。
> 详细步骤见 [docs/阿里云部署教程.md](docs/阿里云部署教程.md)。

海外平台（Render / Railway / Fly.io）三个选一个即可（都基于 `Dockerfile`）：

### B1. Render（云托管，推荐新手）

> ⚠️ 注意：Render 的**免费计划不能挂载持久磁盘**，数据会随部署/休眠重置，不适合做云同步的数据中心。想要数据永久保存，需使用 **Starter 计划（约 $7/月）+ 1GB 磁盘（约 $0.25/月）**。

**详细图文步骤见 [docs/Render部署教程.md](docs/Render部署教程.md)。** 简要流程：

1. 把 `task-sync` 目录里的**内容**（`server.js`、`public/`、`Dockerfile`、`render.yaml` 等）上传到 GitHub 仓库**根目录**。
2. 到 [render.com](https://render.com) 注册（可用 GitHub 登录）。
3. New → **Blueprint** → 选择该仓库 → Render 自动读取 `render.yaml`（已配置 Starter + 1GB 磁盘）→ Create Resources。
4. 部署完成后拿到 `https://xxx.onrender.com`，浏览器打开、注册账号即可多端使用。

> 免费计划无访问约 15 分钟会休眠、冷启动要几十秒，且**数据不持久**；Starter 计划不休眠、数据持久。

### B2. Fly.io

1. 安装 Fly CLI 并 `fly auth login`。
2. 在 `task-sync` 目录执行：

```bash
fly launch          # 按提示创建 app（会自动读取 fly.toml）
fly volumes create task_data --size 1   # 创建持久卷（首次）
fly deploy
```

### B3. Railway

1. 把目录上传到 GitHub，到 [railway.app](https://railway.app) 用 GitHub 登录。
2. New Project → Deploy from GitHub repo（Railway 会自动识别 `Dockerfile`）。
3. 在服务设置里添加一个 **Volume**，挂载路径填 `/data`（用于持久化数据）。

## 六、把网页“安装”成桌面应用（PWA）

服务端跑起来后，用 Chrome / Edge 打开你的网址：

- 电脑：地址栏右侧出现「安装」图标（或菜单里的“安装任务管理工作台”），点一下就变成独立窗口的桌面应用，像普通软件一样从开始菜单/桌面启动。
- 手机（安卓）：浏览器菜单选“添加到主屏幕”；iPhone 用 Safari 的“添加到主屏幕”。
- 已访问过的页面会缓存，断网时也能打开（数据同步则需联网）。

> 注：PWA 的“安装”和“离线打开”只在 **https 或 localhost** 下生效；纯局域网 IP（http://192.168.x.x）也能正常使用网页，只是浏览器可能不显示“安装”按钮。

## 七、安全注意事项

- 账号密码使用 **scrypt 加盐哈希** 存储，服务器上不保存明文密码。
- 登录使用 **Bearer Token**，有效期 30 天。
- **强烈建议**正式对外使用时启用 **HTTPS**（云托管平台一般自动提供；自托管可用 Caddy/Nginx 反代加证书），否则密码在传输中是明文。
- 服务端没有做“找回密码”功能（密码不可逆加密）。忘记密码的话，删除 `data/data.json` 里对应用户的记录即可（会同时清掉该账号数据），或直接删掉 `data` 目录重建。

## 八、常见问题

- **其它设备连不上？** 检查服务器防火墙/安全组是否放行 8000 端口；局域网内确认用的是服务器 IP 而非 localhost。
- **登录时服务器地址填什么？** 如果是通过浏览器直接访问部署好的网址，留空即可；如果前端单独打开、要连远程服务器，填 `http://IP:8000` 或 `https://你的域名`（末尾不要带 `/`）。
- **数据能备份吗？** 页面右上角「导出备份」保存 `.json`；服务器端也可直接备份 `data/data.json` 文件。
- **想换数据库？** 默认是 JSON 文件存储，个人/小团队足够。数据量大时可自行把 `server.js` 里的存取函数换成 SQLite/Postgres。
