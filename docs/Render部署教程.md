# 在 Render 上部署「任务管理工作台」— 详细教程

本教程带你从零开始，把云同步服务部署到 Render，拿到一个 `https://xxx.onrender.com` 网址，
之后在任意设备打开这个网址、注册账号，就能多端同步任务。

> 配套文件：仓库根目录的 `render.yaml`（Blueprint 配置）、`Dockerfile`（容器镜像定义）。
> 阅读前建议先看下一节的「免费 vs 付费」，避免部署后发现数据会丢。

---

## 0. 先看清楚：免费 vs 付费（重要 ⚠️）

Render 对「持久磁盘」有硬性限制，直接决定你的数据会不会丢：

| 计划 | 价格 | 能否挂持久磁盘 | 数据会丢吗 | 适合 |
|---|---|---|---|---|
| Free（免费） | 0 | ❌ 不能 | 会（部署/重启/休眠后重置） | 临时体验、测试 |
| Starter（入门） | 约 $7/月 | ✅ 能（磁盘另计约 $0.25/GB/月） | 不会 | **正式使用** |

**结论**：本应用需要保存账号和任务数据，所以**必须用 Starter 计划 + 持久磁盘**才能长期使用。
如果你只想先免费体验、不在乎数据，可以把 `render.yaml` 里 `plan: starter` 改成 `plan: free` 并删除 `disk` 段。

> 想完全免费又要持久化？见文末「第 7 节：完全免费的替代方案」。

---

## 1. 前置准备（10 分钟）

需要两个账号 + 一份代码：

1. **GitHub 账号**：<https://github.com>（免费注册）。
2. **Render 账号**：<https://render.com>（建议直接用 GitHub 账号一键登录）。
3. **把 `task-sync` 目录上传到 GitHub 仓库**（见下）。

### 1.1 上传代码到 GitHub（二选一）

> ⚠️ 关键：要让 `render.yaml`、`Dockerfile`、`server.js`、`public/` 这些文件**直接位于仓库根目录**，
> 而不是套在一个 `task-sync/` 子文件夹里。否则 Render 找不到配置。

**方式 A：网页上传（无需装任何工具，最简单）**

1. 登录 GitHub → 右上角 **+** → **New repository**。
2. Repository name 填 `task-sync`（随意），选 **Public**，点 **Create repository**。
3. 进入新仓库页，点 **uploading an existing file**（上传文件）。
4. 在电脑上打开 `task-sync` 文件夹，**选中里面的全部内容**（`server.js`、`public` 文件夹、`Dockerfile`、`render.yaml`、`README.md`、`start.bat` 等），一起拖进网页的上传区域。
   - 注意是拖「文件夹里面的内容」，不是拖 `task-sync` 文件夹本身。
5. 点 **Commit changes**。

**方式 B：用 git 命令（更规范，适合后续更新）**

```bash
# 在 task-sync 目录里执行
git init
git add .
git commit -m "init task-sync"
git branch -M main
git remote add origin https://github.com/你的用户名/task-sync.git
git push -u origin main
```

之后每次改代码，`git add . && git commit -m "..." && git push` 即可触发 Render 自动重新部署。

---

## 2. 方式一：Blueprint 一键部署（推荐）

这是最省事的方式，Render 会自动读取仓库里的 `render.yaml` 并创建好所有资源（服务 + 磁盘 + 环境变量）。

1. 登录 Render 控制台 <https://dashboard.render.com>。
2. 点右上角 **New** → 选择 **Blueprint**。
3. 点 **Connect a repository**（首次会要求授权 Render 访问 GitHub）→ 选择刚才的 `task-sync` 仓库。
4. Render 会解析 `render.yaml`，列出将要创建的服务，确认：
   - **Name**：`task-sync`
   - **Plan**：`Starter`（$7/月）
   - **Disk**：`data`，1 GB，挂载在 `/data`
   - **Health Check Path**：`/api/health`
5. 点 **Create Resources**（或 **Apply**）开始部署。首次需要绑定信用卡（Starter 是付费计划）。
6. 等待几分钟，状态变成 **Live** 后，页面上方会显示服务地址：
   `https://task-sync-xxxx.onrender.com`

部署完成 ✅，跳到「第 4 节」开始使用。

---

## 3. 方式二：手动创建 Web Service（不用 render.yaml）

如果你想手动控制每一步：

1. Render 控制台 → **New** → **Web Service**。
2. **Connect a repository** → 选 `task-sync` 仓库。
3. 填写服务设置：
   - **Name**：`task-sync`
   - **Region**：选离你最近的，国内用户建议 **Singapore（新加坡）**
   - **Branch**：`main`
   - **Runtime**：**Docker**
   - **Dockerfile Path**：`Dockerfile`
   - **Instance Type**：**Starter**
4. 添加持久磁盘：找到 **Disks**（或 **Advanced → Add Disk**）：
   - **Mount Path**：`/data`
   - **Size**：`1 GB`
5. 添加环境变量（**Environment** 区块）：
   - `PORT` = `8000`
   - `DATA_DIR` = `/data`
6. **Health Check Path** 填 `/api/health`（可选但建议，便于 Render 判断服务健康）。
7. 点 **Create Web Service**，等待构建（第一次要拉取镜像、构建容器，约 3–5 分钟）。
8. 状态变 **Live** 后，记下 `https://task-sync-xxxx.onrender.com` 地址。

---

## 4. 部署完成后：注册账号并开始用

1. 用浏览器打开 `https://task-sync-xxxx.onrender.com`。
2. 页面右上角点 **登录 / 注册**。
3. 切到 **注册** 标签，填用户名和密码（服务器地址留空即可，会自动用当前网址）。
4. 注册即登录，之后就能：
   - 新建任务、排甘特图、写工作记录、归档……
   - 右上角会显示「已登录：你的用户名」「上次同步时间」。

**多端同步**：在另一台电脑 / 手机上打开同一个网址 → 登录**同一个账号** → 数据自动拉下来，之后的修改也会自动同步。

**安装成桌面应用**：Chrome/Edge 地址栏右侧会出现「安装」图标，点一下就能像普通软件一样从桌面/开始菜单打开（见 README 第六节）。

---

## 5. 常用维护操作

- **看日志**：Render 控制台 → 服务 → **Logs**，排查启动错误。
- **改环境变量 / 磁盘**：服务 → **Settings** / **Environment** / **Disks**，改完会自动重启。
- **更新代码**：把新代码 push 到 GitHub，Render 会自动重新构建部署（Blueprint 服务默认自动部署）。
- **重启服务**：服务 → **Manual Deploy** → **Deploy latest commit**（或 Restart）。
- **备份数据**：
  1. 页面右上角「导出备份」下载 `.json`；
  2. 或在 Render 服务 → **Disks** 里对磁盘做 **Snapshot**（快照）；
  3. 也可临时把 `DATA_DIR` 数据目录拷出来。

---

## 6. 常见问题（FAQ）

**Q1：打开网址一直转圈 / 打不开？**
免费计划无访问约 15 分钟会休眠，冷启动要等 30–60 秒；Starter 计划不休眠。若长时间打不开，去 Logs 看是否有错误。

**Q2：重新部署后数据没了？**
基本是用了 **free 计划**（没有持久磁盘）。请改成 Starter 并挂载 `/data` 磁盘。数据文件是磁盘上的 `data/data.json`。

**Q3：健康检查失败（Health check failing）？**
确认 `PORT` 环境变量是 `8000`，且健康检查路径是 `/api/health`（返回 `{"ok":true}`）。

**Q4：忘记密码怎么办？**
服务端不保存明文密码、也无法找回。可到 Render 的磁盘里删掉 `data.json` 中对应账号（或用 Shell 进入容器操作），代价是该账号数据会被清空。

**Q5：登录时「服务器地址」填什么？**
直接通过 Render 给的网址访问时**留空即可**；只有单独打开本地前端、连远程服务器时才需要手动填 `https://xxx.onrender.com`。

**Q6：一定要信用卡吗？**
免费计划不需要；Starter 计划需要绑卡（$7/月 + 磁盘约 $0.25/月）。

---

## 7. 想完全免费？替代方案

Render 免费计划不持久，若你不想花 $7/月，可以：

1. **自托管（最推荐，真正免费且数据永久）**：在一台长期开机的电脑 / NAS / 树莓派上 `node server.js` 或 `docker compose up -d`，再配合 **Tailscale**（免费组网）或内网穿透，其它设备通过 IP/域名访问。详见 README「部署方案 A」。
2. **Oracle Cloud 永久免费 VPS**：有一台 Always Free 的云主机，把本项目跑上去（用 Docker 或直接 node），永久免费且持久。
3. **Fly.io**：免费额度里包含少量机器 + 3GB 存储卷，可用 `fly.toml` 部署（`fly launch` + 创建 volume）。

> 说明：Render 的规则（免费计划不支持持久磁盘）以其官方文档为准，见下方参考链接。

---

## 参考

- Render Blueprint 配置说明：<https://render.com/docs/blueprint-spec>
- Render 免费计划说明：<https://render.com/docs/free>
- Render 持久磁盘说明：<https://render.com/docs/disks>
