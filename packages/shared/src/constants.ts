/** Limits shared by the web app, the API and (mirrored by hand) firestore.rules. */
export const LIMITS = {
  postMaxChars: 2000,
  commentMaxChars: 1000,
  displayNameMin: 2,
  displayNameMax: 50,
  usernameMin: 3,
  usernameMax: 20,
  reportDetailsMax: 500,
  announcementTitleMax: 120,
  announcementBodyMax: 2000,
  searchTokensMax: 50,
  avatarMaxBytes: 200 * 1024,
  avatarPixels: 256,
  /** Minimum seconds between two posts by the same user (enforced in rules). */
  postCooldownSeconds: 20,
  /** Minimum seconds between two comments by the same user (enforced in rules). */
  commentCooldownSeconds: 5,
  feedPageSize: 10,
} as const;

/**
 * PROVISIONAL — minimum sign-up age is an open founder/legal decision (D9).
 * Shown as a self-declared confirmation at registration.
 */
export const MIN_AGE = 13;

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const RESIDENCE_OPTIONS = [
  { id: 'hometown', label: 'I live in my hometown' },
  { id: 'ghana', label: 'Elsewhere in Ghana' },
  { id: 'abroad', label: 'Outside Ghana' },
] as const;
export type Residence = (typeof RESIDENCE_OPTIONS)[number]['id'];

export const POST_VISIBILITY = ['akpafu', 'town'] as const;
export type PostVisibility = (typeof POST_VISIBILITY)[number];

/** Phase 1: a single "like" reaction (decision D6). Stored as a type for future growth. */
export const REACTION_TYPES = ['like'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'threat', label: 'Threats or violence' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'misinformation', label: 'False or misleading information' },
  { id: 'defamation', label: 'Defamation' },
  { id: 'fraud', label: 'Fraud' },
  { id: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export const REPORT_TARGET_TYPES = ['post', 'comment', 'user', 'event', 'listing', 'message', 'story', 'directory'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const ROLES = ['super_admin', 'town_admin', 'moderator', 'reporter'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  town_admin: 'Town Admin',
  moderator: 'Moderator',
  reporter: 'Sports reporter',
};

/** Countries offered in the optional "current country" field (ISO 3166-1 alpha-2). */
export const COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'GH', name: 'Ghana' },
  { code: 'TG', name: 'Togo' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'CI', name: "Côte d'Ivoire" },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'IL', name: 'Israel' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'AU', name: 'Australia' },
  { code: 'OTHER', name: 'Other country' },
];

// ---------------- Events, Marketplace, Sports, Notifications, Feedback ----------------

export const EVENT_CATEGORIES = [
  { id: 'festival', label: 'Festival' },
  { id: 'funeral', label: 'Funeral' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'church', label: 'Church programme' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'sports', label: 'Sports' },
  { id: 'community', label: 'Community work' },
  { id: 'other', label: 'Other' },
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number]['id'];

export const LISTING_CATEGORIES = [
  { id: 'food', label: 'Food & farm produce' },
  { id: 'clothing', label: 'Clothing & fabrics' },
  { id: 'electronics', label: 'Phones & electronics' },
  { id: 'household', label: 'Household' },
  { id: 'services', label: 'Services' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'property', label: 'Land & property' },
  { id: 'other', label: 'Other' },
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]['id'];

export const MATCH_STATUSES = [
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'live', label: 'Live' },
  { id: 'halftime', label: 'Half time' },
  { id: 'finished', label: 'Full time' },
  { id: 'postponed', label: 'Postponed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number]['id'];

export const MATCH_UPDATE_TYPES = [
  { id: 'goal', label: 'Goal', emoji: '⚽' },
  { id: 'yellow', label: 'Yellow card', emoji: '🟨' },
  { id: 'red', label: 'Red card', emoji: '🟥' },
  { id: 'sub', label: 'Substitution', emoji: '🔁' },
  { id: 'chance', label: 'Big chance', emoji: '🔥' },
  { id: 'note', label: 'Update', emoji: '📣' },
] as const;
export type MatchUpdateType = (typeof MATCH_UPDATE_TYPES)[number]['id'];

export const EXTRA_LIMITS = {
  eventTitleMax: 120,
  eventDescriptionMax: 2000,
  eventLocationMax: 200,
  listingTitleMax: 100,
  listingDescriptionMax: 1500,
  listingPriceMax: 10_000_000,
  priceUnitMax: 30,
  teamNameMax: 50,
  competitionMax: 80,
  matchUpdateMax: 200,
  feedbackMax: 2000,
  imageMaxBytes: 400 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  videoMaxSeconds: 180,
  videosPerMember: 30,
  audioMaxBytes: 3 * 1024 * 1024,
  audioMaxSeconds: 120,
  audioPerMember: 500,
  mediaPerPost: 4,
  imageMaxPixels: 1280,
  /** Seconds between two events / listings by the same user. */
  eventCooldownSeconds: 60,
  listingCooldownSeconds: 60,
} as const;

export const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;
