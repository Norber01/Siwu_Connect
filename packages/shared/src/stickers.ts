/**
 * Built-in chat stickers: everyday greetings in Twi and English. (Siwu-language stickers can be added once the
 * words are confirmed by speakers, like the Siwu word of the day.) The id is what a message stores; never rename one.
 */
export interface StickerDef {
  id: string;
  text: string;
  emoji: string;
  /** Gradient colours (from, to). */
  colors: [string, string];
}

export const STICKERS: StickerDef[] = [
  { id: 'akwaaba', text: 'Akwaaba!', emoji: '🤗', colors: ['#f59e0b', '#ef4444'] },
  { id: 'ayekoo', text: 'Ayekoo!', emoji: '👏🏾', colors: ['#10b981', '#047857'] },
  { id: 'medaase', text: 'Medaase', emoji: '🙏🏾', colors: ['#8b5cf6', '#6d28d9'] },
  { id: 'chale', text: 'Chale!', emoji: '😎', colors: ['#0ea5e9', '#1d4ed8'] },
  { id: 'eiii', text: 'Eiii!', emoji: '😱', colors: ['#f43f5e', '#be123c'] },
  { id: 'ete_sen', text: 'Ɛte sɛn?', emoji: '👋🏾', colors: ['#14b8a6', '#0f766e'] },
  { id: 'me_ho_ye', text: 'Me ho yɛ', emoji: '😊', colors: ['#84cc16', '#4d7c0f'] },
  { id: 'up_akpafu', text: 'Up Akpafu!', emoji: '💚', colors: ['#16a34a', '#14532d'] },
  { id: 'goal', text: 'GOAL!', emoji: '⚽', colors: ['#22c55e', '#15803d'] },
  { id: 'congrats', text: 'Congrats!', emoji: '🎉', colors: ['#ec4899', '#9333ea'] },
  { id: 'happy_birthday', text: 'Happy Birthday!', emoji: '🎂', colors: ['#f97316', '#db2777'] },
  { id: 'thank_you', text: 'Thank you', emoji: '💛', colors: ['#eab308', '#ca8a04'] },
  { id: 'good_morning', text: 'Good morning', emoji: '☀️', colors: ['#fbbf24', '#f97316'] },
  { id: 'good_night', text: 'Good night', emoji: '🌙', colors: ['#6366f1', '#1e1b4b'] },
  { id: 'amen', text: 'Amen', emoji: '🙏🏾', colors: ['#a855f7', '#581c87'] },
  { id: 'lol', text: 'LOL', emoji: '😂', colors: ['#facc15', '#f59e0b'] },
  { id: 'on_my_way', text: 'On my way', emoji: '🚶🏾', colors: ['#06b6d4', '#0e7490'] },
  { id: 'miss_you', text: 'Miss you', emoji: '🥺', colors: ['#fb7185', '#e11d48'] },
  { id: 'well_done', text: 'Well done', emoji: '👍🏾', colors: ['#3b82f6', '#1e40af'] },
  { id: 'home', text: 'Home sweet home', emoji: '🏡', colors: ['#d97706', '#92400e'] },
  { id: 'safe_journey', text: 'Safe journey', emoji: '✈️', colors: ['#38bdf8', '#0369a1'] },
  { id: 'sorry', text: 'Sorry o', emoji: '😔', colors: ['#94a3b8', '#475569'] },
];

export const stickerById = (id: string): StickerDef | undefined => STICKERS.find((s) => s.id === id);

/** How many own stickers a member can keep. */
export const MY_STICKERS_MAX = 60;
