const PHONE_KEY  = 'mexicano_whatsapp_phone';
const APIKEY_KEY = 'mexicano_whatsapp_apikey';

export function getWhatsAppConfig() {
  return {
    phone:  localStorage.getItem(PHONE_KEY)  || '',
    apiKey: localStorage.getItem(APIKEY_KEY) || '',
  };
}

export function saveWhatsAppConfig({ phone, apiKey }) {
  localStorage.setItem(PHONE_KEY,  phone.trim());
  localStorage.setItem(APIKEY_KEY, apiKey.trim());
}

export function clearWhatsAppConfig() {
  localStorage.removeItem(PHONE_KEY);
  localStorage.removeItem(APIKEY_KEY);
}

export async function sendDoodleAlert(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const { phone, apiKey } = getWhatsAppConfig();
  if (!phone || !apiKey) return;

  const added   = selectedAdded.length   ? selectedAdded.join(', ')   : 'none';
  const removed = selectedRemoved.length ? selectedRemoved.join(', ') : 'none';
  const text    = `🎾 Doodle update — ${playerName} (${yearMonth})\n✅ Added: ${added}\n❌ Removed: ${removed}`;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) console.warn('[whatsapp] alert failed:', res.status);
  } catch (err) {
    console.warn('[whatsapp] alert error:', err);
  }
}
