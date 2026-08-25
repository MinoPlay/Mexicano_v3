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
];
