/**
 * Pinned announcements — always-visible entries in the notification bell
 * popup that are never removed by "Clear all" (unlike push history in
 * `notification-store.js`). The list only shows the title; clicking an
 * entry opens a detail popup with the full, mobile-friendly body.
 */

export const PINNED_ANNOUNCEMENTS = [
  {
    id: 'fine-jar-2026',
    title: '🎾 The fine jar is open!',
    body: `It's official, everyone – we're introducing a fine jar for morning mexicano (Tuesday + Thursday). The format only works when everyone shows up, so from now on hitting snooze will cost you:

📋 RATES:
✅ Cancel by 16:00 the day before → Free
⏰ Cancel after 16:00 → 75 kr
🐌 Late 6:00–6:15 → 50 kr
🐢 Late 6:15–6:30 → 100 kr
👻 Later than 6:30 or no-show → 200 kr

📌 RULES:
• We play at 6:00 SHARP – you count as "on time" when you're standing on the court ready to play. Not in the locker room, not in the parking lot. 😉
• Fines are paid to the MobilePay box immediately – no running tabs.
• No exceptions and no negotiating – same rules for everyone, and that's exactly what keeps it fair.

🍻 AND THE BEST PART:
Every krone goes straight to our outings. So when you oversleep, you're basically buying the team a round – cheers for that! 🙌`,
  },
  {
    id: 'practical-info-2026',
    title: 'ℹ️ Practical info',
    body: `📅 Tuesday + Thursday, 06:00–08:00
📍 Match Padel Ballerup, Telegrafvej 6, 2750 Ballerup
💡 Lights on from 05:30 – time to warm up
⏱️ 06:00 sharp – mexicano, first to 25 points
📧 Courts + access code sent by mail 1–2 days before (also here)
💰 90 kr/person for 2 hours (non-members)
📲 Monthly MobilePay request based on attendance – send your number
🔢 1–4 courts booked depending on turnout`,
  },
];
