require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const RssParser = require('rss-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Init
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const parser = new RssParser();
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const db = new Database(path.join(dataDir, 'bot.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS posted (blog_id TEXT PRIMARY KEY, title TEXT, link TEXT, date TEXT);
`);

// Default settings
const defaults = {
  mode: 'quote',
  show_image: 'true',
  interval: '5',
  tutorial: process.env.TUTORIAL_LINK || 'https://t.me/animethic2/195',
  channel: process.env.CHANNEL_ID,
  blog: process.env.BLOG_URL || 'https://www.animethic.in',
  post_mode: 'auto'
};

const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(defaults).forEach(([k, v]) => stmt.run(k, String(v)));

function getSet(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function setSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function isPosted(blogId) {
  return !!db.prepare('SELECT blog_id FROM posted WHERE blog_id = ?').get(blogId);
}

function markPosted(blogId, title, link) {
  db.prepare('INSERT OR IGNORE INTO posted (blog_id, title, link, date) VALUES (?, ?, ?, ?)')
    .run(blogId, title, link, new Date().toISOString());
}

const ADMIN = process.env.ADMIN_ID;

// ========== RSS CHECKER ==========
async function checkRSS() {
  const blogUrl = getSet('blog');
  const feedUrl = `${blogUrl}/feeds/posts/default?alt=rss&max-results=10`;
  
  try {
    const feed = await parser.parseURL(feedUrl);
    let count = 0;
    
    for (const item of feed.items) {
      const blogId = item.guid || item.link;
      
      if (isPosted(blogId)) continue;
      count++;
      
      let imageUrl = null;
      if (item.content) {
        const match = item.content.match(/<img[^>]+src="([^"]+)"/);
        if (match) imageUrl = match[1];
      }
      
      const post = { blogId, title: item.title, link: item.link, imageUrl };
      const postMode = getSet('post_mode');
      
      if (postMode === 'manual') {
        await bot.sendMessage(ADMIN, `📬 Pending: ${item.title}\n/setup to approve`);
      } else {
        await sendToChannel(post);
      }
    }
    
    if (count > 0) console.log(`📊 ${count} new posts`);
  } catch (e) {
    console.error('RSS Error:', e.message);
  }
}

// ========== POST TO CHANNEL ==========
async function sendToChannel(post) {
  const mode = getSet('mode');
  const showImg = getSet('show_image');
  const tutLink = getSet('tutorial');
  const chId = getSet('channel');
  
  try {
    if (mode === 'button') {
      const keyboard = [
        [{ text: '📥 DOWNLOAD', url: post.link }],
        [{ text: '👉 Download Tutorial 👈', url: tutLink }]
      ];
      
      if (showImg === 'true' && post.imageUrl) {
        await bot.sendPhoto(chId, post.imageUrl, {
          caption: post.title,
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await bot.sendMessage(chId, post.title, {
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    } else {
      // Quote mode - SIMPLE, NO SPECIAL CHARS
      const msg = `${post.title}\n\nLink -\n>${post.link}\n\n👉 Download Tutorial 👈\n${tutLink}`;
      
      if (showImg === 'true' && post.imageUrl) {
        await bot.sendPhoto(chId, post.imageUrl, {
          caption: msg,
          disable_web_page_preview: true
        });
      } else {
        await bot.sendMessage(chId, msg, {
          disable_web_page_preview: true
        });
      }
    }
    
    markPosted(post.blogId, post.title, post.link);
    console.log(`✅ Posted: ${post.title}`);
  } catch (e) {
    console.error(`❌ Failed: ${post.title}`, e.message);
  }
}

// ========== START RSS ==========
setInterval(checkRSS, parseInt(getSet('interval')) * 60000);
checkRSS();

// ========== BOT COMMANDS ==========
bot.onText(/\/start/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN) return;
  
  const mode = getSet('mode');
  const postMode = getSet('post_mode');
  
  await bot.sendMessage(ADMIN, `🤖 *ANIME POSTER BOT*\n\nMode: ${mode}\nPost: ${postMode}\nInterval: ${getSet('interval')}min`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎨 Quote/Button', callback_data: 'toggle_mode' }],
        [{ text: '⚡ Auto/Manual', callback_data: 'toggle_post' }],
        [{ text: '🖼️ Image ON/OFF', callback_data: 'toggle_img' }],
        [{ text: '📊 Stats', callback_data: 'stats' }]
      ]
    }
  });
});

bot.on('callback_query', async (q) => {
  if (q.message.chat.id.toString() !== ADMIN) return;
  
  const data = q.data;
  
  if (data === 'toggle_mode') {
    const cur = getSet('mode');
    setSet('mode', cur === 'quote' ? 'button' : 'quote');
    await bot.answerCallbackQuery(q.id, { text: `✅ Switched to ${cur === 'quote' ? 'Button' : 'Quote'}!` });
  } else if (data === 'toggle_post') {
    const cur = getSet('post_mode');
    setSet('post_mode', cur === 'auto' ? 'manual' : 'auto');
    await bot.answerCallbackQuery(q.id, { text: `✅ ${cur === 'auto' ? 'Manual' : 'Auto'} mode!` });
  } else if (data === 'toggle_img') {
    const cur = getSet('show_image');
    setSet('show_image', cur === 'true' ? 'false' : 'true');
    await bot.answerCallbackQuery(q.id, { text: `✅ Image ${cur === 'true' ? 'OFF' : 'ON'}!` });
  } else if (data === 'stats') {
    const count = db.prepare('SELECT COUNT(*) as c FROM posted').get().c;
    await bot.answerCallbackQuery(q.id, { text: `📊 Total Posted: ${count}` });
  }
});

console.log('🤖 Bot running...');
