require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const RssParser = require('rss-parser');
const fs = require('fs');
const path = require('path');

// ========== CONFIG ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BLOG_URL = process.env.BLOG_URL || 'https://www.animethic.in';
const TUTORIAL_LINK = process.env.TUTORIAL_LINK || 'https://t.me/animethic2/195';

// ========== INIT ==========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const parser = new RssParser();

// ========== SIMPLE JSON DATABASE ==========
const DB_FILE = path.join(__dirname, 'data.json');
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ posted: [], settings: { mode: 'quote', showImage: true, postMode: 'auto' } }));
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function isPosted(blogId) {
  const db = readDB();
  return db.posted.includes(blogId);
}

function markPosted(blogId) {
  const db = readDB();
  db.posted.push(blogId);
  writeDB(db);
}

function getSetting(key) {
  const db = readDB();
  return db.settings[key];
}

function setSetting(key, value) {
  const db = readDB();
  db.settings[key] = value;
  writeDB(db);
}

// ========== RSS CHECK ==========
async function checkRSS() {
  const feedUrl = `${BLOG_URL}/feeds/posts/default?alt=rss&max-results=5`;
  
  try {
    const feed = await parser.parseURL(feedUrl);
    
    for (const item of feed.items) {
      const blogId = item.guid || item.link;
      
      if (isPosted(blogId)) {
        console.log('⏭️ Skip:', item.title);
        continue;
      }

      console.log('🆕 New:', item.title);
      
      let imageUrl = null;
      if (item.content) {
        const match = item.content.match(/<img[^>]+src="([^"]+)"/);
        if (match) imageUrl = match[1];
      }

      const postMode = getSetting('postMode');
      
      if (postMode === 'manual') {
        await bot.sendMessage(ADMIN_ID, `📬 New Post Pending:\n\n${item.title}\n\n/setup to change mode`);
      } else {
        await sendPost(item.title, item.link, imageUrl);
      }
      
      markPosted(blogId);
    }
  } catch (e) {
    console.error('RSS Error:', e.message);
  }
}

// ========== POST TO CHANNEL ==========
async function sendPost(title, link, imageUrl) {
  const mode = getSetting('mode');
  const showImage = getSetting('showImage');

  try {
    if (mode === 'button') {
      const keyboard = [
        [{ text: '📥 DOWNLOAD', url: link }],
        [{ text: '👉 Download Tutorial 👈', url: TUTORIAL_LINK }]
      ];

      if (showImage && imageUrl) {
        await bot.sendPhoto(CHANNEL_ID, imageUrl, {
          caption: title,
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        await bot.sendMessage(CHANNEL_ID, title, {
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    } else {
      // Quote mode - simple text
      const caption = `${title}\n\nLink -\n>${link}\n\n👉 Download Tutorial 👈\n${TUTORIAL_LINK}`;

      if (showImage && imageUrl) {
        await bot.sendPhoto(CHANNEL_ID, imageUrl, {
          caption: caption
        });
      } else {
        await bot.sendMessage(CHANNEL_ID, caption, {
          disable_web_page_preview: true
        });
      }
    }

    console.log('✅ Posted:', title);
  } catch (e) {
    console.error('❌ Post Error:', e.message);
  }
}

// ========== BOT MENU ==========
bot.onText(/\/start|\/setup/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;

  const mode = getSetting('mode');
  const postMode = getSetting('postMode');
  const showImg = getSetting('showImage');

  await bot.sendMessage(ADMIN_ID, 
    `🤖 *ANIME POSTER BOT*\n\n` +
    `📝 Style: ${mode}\n` +
    `⚡ Post: ${postMode}\n` +
    `🖼️ Image: ${showImg ? 'ON' : 'OFF'}\n\n` +
    `Select option:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `📝 ${mode === 'quote' ? '✅ Quote' : 'Quote'}`, callback_data: 'mode_quote' },
            { text: `🔘 ${mode === 'button' ? '✅ Button' : 'Button'}`, callback_data: 'mode_button' }
          ],
          [
            { text: `🟢 ${postMode === 'auto' ? '✅ Auto' : 'Auto'}`, callback_data: 'post_auto' },
            { text: `🟡 ${postMode === 'manual' ? '✅ Manual' : 'Manual'}`, callback_data: 'post_manual' }
          ],
          [
            { text: `🖼️ Image: ${showImg ? 'ON' : 'OFF'}`, callback_data: 'toggle_image' }
          ],
          [
            { text: '🔄 Check Now', callback_data: 'check_now' }
          ]
        ]
      }
    }
  );
});

bot.on('callback_query', async (q) => {
  if (q.message.chat.id.toString() !== ADMIN_ID) return;
  
  const data = q.data;
  
  if (data === 'mode_quote') {
    setSetting('mode', 'quote');
    await bot.answerCallbackQuery(q.id, { text: '✅ Quote Mode ON' });
    await q.message.delete();
    await bot.sendMessage(ADMIN_ID, '/setup');
  } else if (data === 'mode_button') {
    setSetting('mode', 'button');
    await bot.answerCallbackQuery(q.id, { text: '✅ Button Mode ON' });
    await q.message.delete();
    await bot.sendMessage(ADMIN_ID, '/setup');
  } else if (data === 'post_auto') {
    setSetting('postMode', 'auto');
    await bot.answerCallbackQuery(q.id, { text: '🟢 Auto Post ON' });
    await q.message.delete();
    await bot.sendMessage(ADMIN_ID, '/setup');
  } else if (data === 'post_manual') {
    setSetting('postMode', 'manual');
    await bot.answerCallbackQuery(q.id, { text: '🟡 Manual Mode ON' });
    await q.message.delete();
    await bot.sendMessage(ADMIN_ID, '/setup');
  } else if (data === 'toggle_image') {
    const cur = getSetting('showImage');
    setSetting('showImage', !cur);
    await bot.answerCallbackQuery(q.id, { text: `🖼️ Image ${!cur ? 'ON' : 'OFF'}` });
    await q.message.delete();
    await bot.sendMessage(ADMIN_ID, '/setup');
  } else if (data === 'check_now') {
    await bot.answerCallbackQuery(q.id, { text: '🔄 Checking...' });
    await checkRSS();
  }
});

// ========== START ==========
console.log('🤖 Bot Started!');
setInterval(checkRSS, 5 * 60 * 1000);
checkRSS();
