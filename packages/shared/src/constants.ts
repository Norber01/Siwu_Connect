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
  feedPageSize: 20,
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

export const REPORT_TARGET_TYPES = ['post', 'comment', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const ROLES = ['super_admin', 'town_admin', 'moderator'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  town_admin: 'Town Admin',
  moderator: 'Moderator',
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
