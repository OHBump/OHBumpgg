require("dotenv").config();
const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const randomstring = require("randomstring");

const app = express();
const PORT = process.env.PORT;

const ADMIN_IDS = ["1392056948089684119"];
const BADGE_LIST = ["Admin"];

const SERVER_FILE = "servers.json";
const REQUEST_FILE = "requests.json";
const COMMENT_FILE = "comments.json";

function loadJson(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  return [];
}
function saveJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
let servers = loadJson(SERVER_FILE);
let requests = loadJson(REQUEST_FILE);
let comments = loadJson(COMMENT_FILE);

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "PJBEpT564",
    resave: false,
    saveUninitialized: false,
  })
);
app.use(express.static(__dirname));

function isAdmin(user) {
  return user && ADMIN_IDS.includes(user.id);
}

// ========== DISCORD OAUTH2 ==========
app.get("/auth/discord", (req, res) => {
  const state = randomstring.generate(24);
  req.session.oauth_state = state;
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const REDIRECT_URI = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const scope = "identify guilds";
  const params = `client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${scope}&state=${state}`;
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  if (req.query.state !== req.session.oauth_state) return res.status(400).send("OAuth failed (state mismatch)");
  if (!req.query.code) return res.status(400).send("OAuth failed (no code)");
  // Token
  const params = new URLSearchParams();
  params.append("client_id", process.env.DISCORD_CLIENT_ID);
  params.append("client_secret", process.env.DISCORD_CLIENT_SECRET);
  params.append("grant_type", "authorization_code");
  params.append("code", req.query.code);
  params.append("redirect_uri", process.env.DISCORD_REDIRECT_URI);
  params.append("scope", "identify guilds");
  // Exchange
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return res.status(403).send("OAuth failed");
  // Get user
  const uRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const user = await uRes.json();
  // Save tokens for /guilds fetch
  req.session.user = user;
  req.session.token = tokenData;
  res.redirect("/");
});
// Auth/session info for frontend
app.get("/api/auth/me", async (req, res) => {
  if (!req.session.user) return res.json({ loggedIn: false });
  // User guilds (to check eligible add server)
  let guilds = [];
  if (req.session.token) {
    try {
      const gRes = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: { Authorization: `Bearer ${req.session.token.access_token}` }
      });
      let arr = await gRes.json();
      if (Array.isArray(arr)) guilds = arr.map(g => ({
        id: g.id, name: g.name, owner: g.owner, icon: g.icon, permissions: g.permissions
      }));
    } catch { }
  }
  res.json({
    loggedIn: true,
    user: req.session.user,
    role: isAdmin(req.session.user) ? "admin" : "member",
    guilds,
    BADGE_LIST
  });
});

// No logout endpoint (logout button dihilangkan)

// ===== SERVER DISCOVERY =====
app.get("/api/servers", (req, res) => {
  res.json(servers.filter(s => !s.banned));
});
// KOMEN/RATE
app.get("/api/servers/:id/comments", (req, res) => {
  const id = req.params.id;
  res.json((comments.find(e => e.serverId === id) || { list: [] }).list);
});
app.post("/api/servers/:id/comment", (req, res) => {
  if (!req.session.user) return res.status(403).json({ ok: false });
  const { message, rating } = req.body;
  if (!message || typeof rating !== "number") return res.status(400).json({ ok: false });
  const id = req.params.id;
  let entry = comments.find(e => e.serverId === id);
  if (!entry) {
    entry = { serverId: id, list: [] };
    comments.push(entry);
  }
  entry.list.push({
    user: req.session.user.username + "#" + req.session.user.discriminator,
    userId: req.session.user.id,
    message,
    rating,
    at: Date.now()
  });
  saveJson(COMMENT_FILE, comments);
  res.json({ ok: true });
});

// ADD SERVER REQUEST SYSTEM
app.post("/api/servers/request", async (req, res) => {
  if (!req.session.user || !req.session.token) return res.status(401).json({ ok: false, error: "Not logged in" });
  const { serverId, serverName, invite } = req.body;
  if (!serverId || !serverName || !invite) return res.status(400).json({ ok: false, error: "Missing params" });
  // Cek apakah bot sudah join (user harus punya akses ke server tsb)
  let userGuilds = [];
  try {
    const gRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${req.session.token.access_token}` }
    });
    userGuilds = await gRes.json();
  } catch {}
  const found = Array.isArray(userGuilds) && userGuilds.find(g => g.id === serverId);
  // Cek server udah ada di servers/request
  if (servers.find(s => s.id === serverId)) return res.json({ ok: false, error: "Server already listed" });
  if (requests.find(s => s.serverId === serverId)) return res.json({ ok: false, error: "Server already requested" });
  if (!found) return res.json({ ok: false, error: "Bot not in that server or you have no access" });
  requests.push({
    serverId, serverName, invite,
    requestBy: req.session.user.username + "#" + req.session.user.discriminator,
    userId: req.session.user.id,
    at: Date.now()
  });
  saveJson(REQUEST_FILE, requests);
  res.json({ ok: true });
});

// Admin page, accept/reject request
app.get("/api/requests", (req, res) => {
  if (!req.session.user || !isAdmin(req.session.user)) return res.status(403).json({ ok: false });
  res.json(requests);
});
app.post("/api/requests/:id/approve", (req, res) => {
  if (!req.session.user || !isAdmin(req.session.user)) return res.status(403).json({ ok: false });
  const idx = requests.findIndex(e => e.serverId === req.params.id);
  if (idx < 0) return res.json({ ok: false });
  const reqData = requests.splice(idx, 1)[0];
  servers.push({
    id: reqData.serverId,
    name: reqData.serverName,
    invite: reqData.invite,
    by: reqData.requestBy,
    badge: "Admin",
    at: Date.now(),
    banned: false
  });
  saveJson(REQUEST_FILE, requests);
  saveJson(SERVER_FILE, servers);
  res.json({ ok: true });
});
app.post("/api/requests/:id/reject", (req, res) => {
  if (!req.session.user || !isAdmin(req.session.user)) return res.status(403).json({ ok: false });
  const idx = requests.findIndex(e => e.serverId === req.params.id);
  if (idx < 0) return res.json({ ok: false });
  requests.splice(idx, 1);
  saveJson(REQUEST_FILE, requests);
  res.json({ ok: true });
});

// BAN server (admin)
app.post("/api/servers/:id/ban", (req, res) => {
  if (!req.session.user || !isAdmin(req.session.user)) return res.status(403).json({ ok: false });
  const idx = servers.findIndex(s => s.id === req.params.id);
  if (idx >= 0) {
    servers[idx].banned = true;
    saveJson(SERVER_FILE, servers);
    res.json({ ok: true });
  } else res.json({ ok: false });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("OHBUMP website running at port " + PORT);
});