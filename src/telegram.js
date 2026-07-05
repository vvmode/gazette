function getChatIds() {
  const raw = process.env.TELEGRAM_CHAT_ID;
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

async function sendToChat(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram send failed for chat ${chatId}: ${res.status} ${await res.text()}`);
  }
}

export async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getChatIds();

  if (!token || chatIds.length === 0) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in .env");
  }

  for (const chatId of chatIds) {
    await sendToChat(token, chatId, text);
  }
}
