require('dotenv').config();
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const randomstring = require('randomstring');

const app = express();
const PORT = process.env.PORT || 3000;

//// ---- EDIT ADMIN DAN STAFF DISCORD ID DI SINI ---- ////
const ADMIN_IDS = ['YOUR_ADMIN_DISCORD_ID'];
const STAFF_IDS = ['YOUR_STAFF_DISCORD_ID1', 'YOUR_STAFF_DISCORD_ID2'];
const BADGE_LIST = [
  "Verified","Popular","Active","NSFW","Pro","Premium",
  "Style","Fun","Anime","Bot","Gaming","New","Official","Indo","24/7"
];
///////////////////////////////////////////////////////////

const SERVER_FILE = './servers.json';
function loadServers() {
  if(fs.existsSync(SERVER_FILE)) {
    return JSON.parse(fs.readFileSync(SERVER_FILE, 'utf-8'));
  } else {
    return [];
  }
}
function saveServers(servers) {
  fs.writeFileSync(SERVER_FILE, JSON.stringify(servers, null, 2));
}
let servers = loadServers();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));
app.use('/images', express.static(path.join(__dirname, 'images'))); // Banner, logo
app.use(express.static(__dirname)); // index.html, style.css

// ========== DISCORD OAUTH2 ==========
app.get('/auth/discord', (req, res) => {
  const state = randomstring.generate(24);
  req.session.oauth_state = state;
  const redirect_uri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const params =
    `client_id=${process.env.DISCORD_CLIENT_ID}` +
    `&redirect_uri=${redirect_uri}` +
    `&response_type=code` +
    `&scope=identify email guilds` +
    `&state=${state}`;
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get('/auth/discord/callback', async (req, res) => {
  if(req.query.state !== req.session.oauth_state) return res.status(400).send('Invalid state');
  if(!req.query.code) return res.status(400).send('No code');
  // Token exchange
  const params = new URLSearchParams();
  params.append('client_id', process.env.DISCORD_CLIENT_ID);
  params.append('client_secret', process.env.DISCORD_CLIENT_SECRET);
  params.append('grant_type', 'authorization_code');
  params.append('code', req.query.code);
  params.append('redirect_uri', process.env.DISCORD_REDIRECT_URI);
  params.append('scope', 'identify email guilds');
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  const tokenData = await tokenRes.json();
  if(!tokenData.access_token) return res.status(403).send('OAuth failed');
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const user = await userRes.json();
  req.session.user = user;
  res.redirect('/');
});
app.get('/api/auth/me', (req, res) => {
  let r = {loggedIn:false};
  if(req.session.user) {
    r.loggedIn = true;
    r.user = req.session.user;
    if (ADMIN_IDS.includes(req.session.user.id)) r.role='admin';
    else if (STAFF_IDS.includes(req.session.user.id)) r.role='staff';
    else r.role = 'member';
    r.BADGE_LIST = BADGE_LIST;
  }
  res.json(r);
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(()=>{}); res.json({ok:true}); });

// ========== SERVER LIST & ADMIN CONTROL ==========
app.get('/api/servers',(req,res)=>res.json(servers));
app.post('/api/servers',(req,res)=>{
  if(!req.session.user) return res.status(401).json({ok:false, error:"Login required"});
  const {name,invite,badges=[]} = req.body;
  let safeBadges = (badges||[]).filter(b=>BADGE_LIST.includes(b));
  servers.unshift({
    name, invite, badges: safeBadges, votes:0, by: `${req.session.user.username}#${req.session.user.discriminator}`, at: Date.now()
  });
  saveServers(servers);
  res.json({ok:true});
});
app.post('/api/servers/vote',(req,res)=>{
  if(!req.session.user) return res.status(401).json({ok:false});
  const {idx} = req.body;
  if(typeof idx === 'number' && servers[idx]) {
    servers[idx].votes = (servers[idx].votes||0)+1;
    saveServers(servers);
    res.json({ok:true, votes:servers[idx].votes});
  } else res.json({ok:false});
});

// ========== ADMIN/STAF PANEL CONTROL ==========
function getRole(user) {
  if (!user) return "";
  if (ADMIN_IDS.includes(user.id)) return "admin";
  if (STAFF_IDS.includes(user.id)) return "staff";
  return "";
}
app.post('/api/servers/:idx/badge', (req, res) => {
  if(!req.session.user) return res.status(401).json({ok:false});
  let role = getRole(req.session.user); if(!role) return res.status(403).json({ok:false});
  let idx = parseInt(req.params.idx), {badges} = req.body;
  if(servers[idx]) {
    servers[idx].badges = (badges||[]).filter(b=>BADGE_LIST.includes(b));
    saveServers(servers);
    res.json({ok:true, badges:servers[idx].badges});
  } else res.json({ok:false});
});
app.post('/api/servers/:idx/delete', (req, res) => {
  if(!req.session.user) return res.status(401).json({ok:false});
  let role = getRole(req.session.user); if(!role) return res.status(403).json({ok:false});
  let idx = parseInt(req.params.idx);
  if(servers[idx]) {
    servers.splice(idx,1);
    saveServers(servers);
    res.json({ok:true});
  } else res.json({ok:false});
});
app.post('/api/servers/:idx/ban', (req, res) => {
  if(!req.session.user) return res.status(401).json({ok:false});
  let role = getRole(req.session.user); if(!role) return res.status(403).json({ok:false});
  let idx = parseInt(req.params.idx);
  if(servers[idx]) {
    servers[idx].banned = true;
    saveServers(servers);
    res.json({ok:true});
  } else res.json({ok:false});
});
app.post('/api/servers/:idx/nsfw', (req, res) => {
  if(!req.session.user) return res.status(401).json({ok:false});
  let role = getRole(req.session.user); if(!role) return res.status(403).json({ok:false});
  let idx = parseInt(req.params.idx);
  if(servers[idx]) {
    servers[idx].nsfw = !!req.body.nsfw;
    if(req.body.nsfw && !servers[idx].badges.includes('NSFW')) servers[idx].badges.push('NSFW');
    if(!req.body.nsfw) servers[idx].badges = servers[idx].badges.filter(b=>"NSFW"!==b);
    saveServers(servers);
    res.json({ok:true, nsfw:servers[idx].nsfw});
  } else res.json({ok:false});
});

// ========== FEEDBACK ==========
app.post('/api/feedback', async (req, res) => {
  try {
      const { name, message } = req.body;
      if (!name || !message) return res.status(400).json({ ok: false, error: 'Missing name or message' });
      const webhook = process.env.DISCORD_WEBHOOK_URL;
      const content = `**Feedback from \`${name}\`**:\n${message}`;
      const resp = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content })
      });
      if (resp.ok) res.json({ ok: true });
      else res.status(500).json({ ok: false, error: "Failed webhook" });
  } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
  }
});

// ========== SPA Fallback ==========
app.get('*', (req,res)=>{res.sendFile(path.join(__dirname,'index.html'));});
app.listen(PORT, () => { console.log('OHBUMP website running at http://localhost:'+PORT); });