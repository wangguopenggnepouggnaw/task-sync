#!/usr/bin/env node
/*
 * 任务管理工作台 —— 同步服务端（零第三方依赖，仅用 Node 内置模块）
 *
 * 功能：
 *   - 账号注册 / 登录（scrypt 加盐哈希 + Bearer Token 会话）
 *   - 任务数据同步（按任务 updatedAt 做双向合并，last-write-wins）
 *   - 静态托管 public/ 目录（前端页面）
 *
 * 运行：
 *   node server.js
 *   环境变量：PORT（默认 8000）、DATA_DIR（数据目录，默认 ./data）
 *
 * 说明：数据存为 JSON 文件（data/data.json），采用原子写入。
 *       个人/小团队使用足够；如需更高并发可自行替换为数据库。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_BODY = 20 * 1024 * 1024; // 20MB
const SESSION_TTL = 60 * 60 * 24 * 30 * 1000; // 30 天
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000; // 删除标记保留 90 天

/* ---------- 数据存储 ---------- */
let db = { users: {}, sessions: {}, tasks: {} };
// users: { "<小写用户名>": { username, salt, hash, createdAt } }
// sessions: { "<token>": { username, createdAt } }
// tasks: { "<小写用户名>": [ task, ... ] }

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      db.users = parsed.users || {};
      db.sessions = parsed.sessions || {};
      db.tasks = parsed.tasks || {};
    }
  } catch (e) {
    console.error("[warn] 读取数据文件失败，使用空数据：", e.message);
  }
}
function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}
function tasksOf(username) {
  const key = username.toLowerCase();
  if (!db.tasks[key]) db.tasks[key] = [];
  return db.tasks[key];
}

/* ---------- 密码与会话 ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function verifyPassword(password, salt, expected) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const exp = Buffer.from(expected, "hex");
  return actual.length === exp.length && crypto.timingSafeEqual(actual, exp);
}
function validUsername(u) {
  return typeof u === "string" && /^[A-Za-z0-9_\u4e00-\u9fa5.-]{2,32}$/.test(u);
}
function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { username, createdAt: Date.now() };
  return token;
}
function sessionUser(req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const s = db.sessions[token];
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    delete db.sessions[token];
    return null;
  }
  return s.username;
}

/* ---------- 任务清洗与合并 ---------- */
function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function sanitizeTask(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.id !== "string" || !t.id || t.id.length > 64) return null;
  const out = {
    id: t.id,
    title: typeof t.title === "string" ? t.title.slice(0, 500) : "",
    desc: typeof t.desc === "string" ? t.desc.slice(0, 20000) : "",
    status: ["todo", "doing", "done"].includes(t.status) ? t.status : "todo",
    priority: ["high", "mid", "low"].includes(t.priority) ? t.priority : "mid",
    start: typeof t.start === "string" ? t.start.slice(0, 20) : "",
    end: typeof t.end === "string" ? t.end.slice(0, 20) : "",
    progress: clampInt(t.progress, 0, 100),
    tags: Array.isArray(t.tags) ? t.tags.filter(x => typeof x === "string").map(x => x.slice(0, 40)).slice(0, 50) : [],
    notes: Array.isArray(t.notes) ? t.notes.slice(0, 500).map(n => ({
      time: (n && typeof n.time === "string") ? n.time.slice(0, 40) : "",
      text: (n && typeof n.text === "string") ? n.text.slice(0, 4000) : ""
    })) : [],
    createdAt: typeof t.createdAt === "string" ? t.createdAt.slice(0, 40) : new Date().toISOString(),
    updatedAt: clampInt(t.updatedAt, 0, 9e15) || Date.now(),
    archived: !!t.archived,
    completedAt: typeof t.completedAt === "string" ? t.completedAt.slice(0, 40) : null,
    deleted: !!t.deleted
  };
  return out;
}
function mergeTasks(serverList, incoming) {
  const now = Date.now();
  const map = new Map();
  for (const t of serverList) map.set(t.id, t);
  for (const raw of incoming) {
    const t = sanitizeTask(raw);
    if (!t) continue;
    const existing = map.get(t.id);
    if (!existing || t.updatedAt >= existing.updatedAt) map.set(t.id, t);
  }
  // 清理过期的删除标记
  const cutoff = now - TOMBSTONE_TTL;
  const result = [];
  for (const t of map.values()) {
    if (t.deleted && t.updatedAt < cutoff) continue;
    result.push(t);
  }
  result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return result;
}

/* ---------- HTTP 工具 ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > MAX_BODY) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};
function serveStatic(res, pathname) {
  let p = pathname === "/" ? "/index.html" : pathname;
  let filePath;
  try {
    filePath = path.resolve(PUBLIC_DIR, "." + decodeURIComponent(p));
  } catch (e) {
    res.writeHead(400); return res.end("bad request");
  }
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); return res.end("forbidden");
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回退：找不到文件时返回 index.html（前端路由用）
      const idx = path.join(PUBLIC_DIR, "index.html");
      if (path.extname(p) === "" && fs.existsSync(idx)) {
        fs.readFile(idx, (e2, buf) => {
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(e2 ? "not found" : buf);
        });
      } else {
        res.writeHead(404); res.end("not found");
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------- 路由 ---------- */
async function handle(req, res) {
  const u = new URL(req.url, "http://x");
  const pathname = u.pathname;

  // CORS 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    });
    return res.end();
  }

  // 健康检查
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJSON(res, 200, { ok: true, time: Date.now() });
  }

  // 注册
  if (req.method === "POST" && pathname === "/api/register") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: "请求体无效" }); }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!validUsername(username)) return sendJSON(res, 400, { error: "用户名需 2-32 位，仅含字母/数字/中文/下划线/点/连字符" });
    if (password.length < 6) return sendJSON(res, 400, { error: "密码至少 6 位" });
    const key = username.toLowerCase();
    if (db.users[key]) return sendJSON(res, 409, { error: "该用户名已被注册" });
    const salt = crypto.randomBytes(16).toString("hex");
    db.users[key] = { username, salt, hash: hashPassword(password, salt), createdAt: Date.now() };
    const token = createSession(username);
    saveDb();
    return sendJSON(res, 200, { token, username });
  }

  // 登录
  if (req.method === "POST" && pathname === "/api/login") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: "请求体无效" }); }
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const key = username.toLowerCase();
    const user = db.users[key];
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return sendJSON(res, 401, { error: "用户名或密码错误" });
    }
    const token = createSession(user.username);
    saveDb();
    return sendJSON(res, 200, { token, username: user.username });
  }

  // 退出登录
  if (req.method === "POST" && pathname === "/api/logout") {
    const h = req.headers["authorization"] || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) { delete db.sessions[m[1]]; saveDb(); }
    return sendJSON(res, 200, { ok: true });
  }

  // 以下需要登录
  const username = sessionUser(req);

  // 当前用户
  if (req.method === "GET" && pathname === "/api/me") {
    if (!username) return sendJSON(res, 401, { error: "未登录或登录已过期" });
    return sendJSON(res, 200, { username });
  }

  // 拉取任务
  if (req.method === "GET" && pathname === "/api/tasks") {
    if (!username) return sendJSON(res, 401, { error: "未登录或登录已过期" });
    return sendJSON(res, 200, { tasks: tasksOf(username), serverTime: Date.now() });
  }

  // 同步（推送 + 合并 + 拉回）
  if (req.method === "POST" && pathname === "/api/sync") {
    if (!username) return sendJSON(res, 401, { error: "未登录或登录已过期" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: "请求体无效" }); }
    const incoming = Array.isArray(body && body.tasks) ? body.tasks : null;
    if (!incoming || incoming.length > 20000) return sendJSON(res, 400, { error: "任务数据格式错误或数量过大" });
    const merged = mergeTasks(tasksOf(username), incoming);
    db.tasks[username.toLowerCase()] = merged;
    saveDb();
    return sendJSON(res, 200, { tasks: merged, serverTime: Date.now() });
  }

  // 静态文件
  if (req.method === "GET") return serveStatic(res, pathname);

  sendJSON(res, 404, { error: "not found" });
}

/* ---------- 启动 ---------- */
loadDb();
const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (err && err.message === "body_too_large") return sendJSON(res, 413, { error: "请求体过大" });
    console.error("[error]", err);
    try { sendJSON(res, 500, { error: "服务器内部错误" }); } catch (e) { res.end(); }
  });
});
server.listen(PORT, HOST, () => {
  console.log("任务同步服务已启动：");
  console.log("  本机访问  http://localhost:" + PORT);
  console.log("  数据目录  " + DATA_DIR);
});
