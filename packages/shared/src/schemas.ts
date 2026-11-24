import { z } from 'zod';
import {
  COUNTRIES,
  LIMITS,
  POST_VISIBILITY,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  RESIDENCE_OPTIONS,
  ROLES,
  USERNAME_PATTERN,
} from './constants';
import { TOWN_IDS } from './towns';
import { cleanMultiline, cleanSingleLine } from './text';

export const townIdSchema = z.enum(TOWN_IDS);

export const usernameSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z
      .string()
      .regex(
        USERNAME_PATTERN,
        `Use ${LIMITS.usernameMin}–${LIMITS.usernameMax} characters: lowercase letters, numbers or _`,
      ),
  );

export const displayNameSchema = z
  .string()
  .transform(cleanSingleLine)
  .pipe(
    z
      .string()
      .min(LIMITS.displayNameMin, `At least ${LIMITS.displayNameMin} characters`)
      .max(LIMITS.displayNameMax, `At most ${LIMITS.displayNameMax} characters`),
  );

const countryCodes = COUNTRIES.map((c) => c.code) as [string, ...string[]];
const residenceIds = RESIDENCE_OPTIONS.map((r) => r.id) as [string, ...string[]];

export const profileSchema = z.object({
  displayName: displayNameSchema,
  hometownId: townIdSchema,
  residence: z.enum(residenceIds as ['hometown', 'ghana', 'abroad']).nullable(),
  countryCode: z.enum(countryCodes).nullable(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

/** Post text may be empty when the post has a photo; the UI checks "text or photo". */
export const postTextSchema = z
  .string()
  .transform(cleanMultiline)
  .pipe(z.string().max(LIMITS.postMaxChars, `Posts can be at most ${LIMITS.postMaxChars} characters`));

export const postSchema = z.object({
  townId: townIdSchema,
  text: postTextSchema,
  visibility: z.enum(POST_VISIBILITY),
});
export type PostInput = z.infer<typeof postSchema>;

export const commentTextSchema = z
  .string()
  .transform(cleanMultiline)
  .pipe(
    z
      .string()
      .min(1, 'Write a comment first')
      .max(LIMITS.commentMaxChars, `Comments can be at most ${LIMITS.commentMaxChars} characters`),
  );

const reasonIds = REPORT_REASONS.map((r) => r.id) as [string, ...string[]];

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  reason: z.enum(reasonIds),
  details: z.string().transform(cleanMultiline).pipe(z.string().max(LIMITS.reportDetailsMax)),
});

/** --- Admin API request bodies (validated by the Worker) --- */

export const moderationNoteSchema = z.object({
  note: z.string().transform(cleanMultiline).pipe(z.string().max(500)).optional().default(''),
});

export const resolveReportSchema = z.object({
  action: z.enum(['dismiss', 'remove_content', 'remove_content_and_suspend']),
  note: z.string().transform(cleanMultiline).pipe(z.string().max(500)).optional().default(''),
});

export const pinSchema = z.object({ pinned: z.boolean() });

export const announcementSchema = z.object({
  townId: z.union([townIdSchema, z.literal('all')]),
  title: z
    .string()
    .transform(cleanSingleLine)
    .pipe(z.string().min(3).max(LIMITS.announcementTitleMax)),
  body: z
    .string()
    .transform(cleanMultiline)
    .pipe(z.string().min(1).max(LIMITS.announcementBodyMax)),
  pinned: z.boolean().default(false),
  /** ISO date string; announcement disappears from feeds after this time. */
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const announcementUpdateSchema = announcementSchema
  .partial()
  .extend({ status: z.enum(['published', 'archived']).optional() });

export const grantRoleSchema = z
  .object({
    username: usernameSchema,
    role: z.enum(ROLES),
    townIds: z.array(townIdSchema).max(TOWN_IDS.length).default([]),
  })
  .refine((v) => v.role === 'super_admin' || v.role === 'reporter' || v.townIds.length > 0, {
    message: 'Choose at least one town for this role',
    path: ['townIds'],
  });
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;

// ---------------- Events, Marketplace, Sports, Feedback ----------------
import {
  EVENT_CATEGORIES,
  EXTRA_LIMITS,
  LISTING_CATEGORIES,
  MATCH_STATUSES,
  MATCH_UPDATE_TYPES,
  PHONE_PATTERN,
} from './constants';

const ids = <T extends readonly { id: string }[]>(list: T) => list.map((x) => x.id) as [T[number]['id'], ...T[number]['id'][]];

export const eventSchema = z
  .object({
    townId: townIdSchema,
    title: z.string().transform(cleanSingleLine).pipe(z.string().min(3, 'Give the event a title').max(EXTRA_LIMITS.eventTitleMax)),
    description: z.string().transform(cleanMultiline).pipe(z.string().max(EXTRA_LIMITS.eventDescriptionMax)),
    category: z.enum(ids(EVENT_CATEGORIES)),
    location: z.string().transform(cleanSingleLine).pipe(z.string().max(EXTRA_LIMITS.eventLocationMax)),
    startsAt: z.date({ invalid_type_error: 'Choose a date and time' }),
    endsAt: z.date().nullable(),
  })
  .refine((e) => !e.endsAt || e.endsAt > e.startsAt, { message: 'The end must be after the start', path: ['endsAt'] });
export type EventInput = z.infer<typeof eventSchema>;

export const listingSchema = z.object({
  townId: townIdSchema,
  title: z.string().transform(cleanSingleLine).pipe(z.string().min(3, 'Give your listing a title').max(EXTRA_LIMITS.listingTitleMax)),
  description: z.string().transform(cleanMultiline).pipe(z.string().max(EXTRA_LIMITS.listingDescriptionMax)),
  category: z.enum(ids(LISTING_CATEGORIES)),
  price: z.number().int('Use whole cedis').min(0).max(EXTRA_LIMITS.listingPriceMax).nullable(),
  priceUnit: z.string().transform(cleanSingleLine).pipe(z.string().max(EXTRA_LIMITS.priceUnitMax)),
  contactPhone: z
    .string()
    .transform((s) => s.replace(/[\s()-]/g, ''))
    .pipe(z.string().regex(PHONE_PATTERN, 'Enter a phone number with country code, e.g. +233241234567'))
    .nullable(),
  contactWhatsApp: z.boolean(),
});
export type ListingInput = z.infer<typeof listingSchema>;

const teamSchema = z.object({
  name: z.string().transform(cleanSingleLine).pipe(z.string().min(2, 'Enter a team name').max(EXTRA_LIMITS.teamNameMax)),
  townId: townIdSchema.nullable(),
});

export const matchSchema = z
  .object({
    competition: z.string().transform(cleanSingleLine).pipe(z.string().min(3, 'Enter the competition name').max(EXTRA_LIMITS.competitionMax)),
    home: teamSchema,
    away: teamSchema,
    venue: z.string().transform(cleanSingleLine).pipe(z.string().max(EXTRA_LIMITS.eventLocationMax)),
    kickoffAt: z.date({ invalid_type_error: 'Choose the kick-off date and time' }),
  })
  .refine((m) => m.home.name.toLowerCase() !== m.away.name.toLowerCase(), { message: 'Choose two different teams', path: ['away'] });
export type MatchInput = z.infer<typeof matchSchema>;

export const matchStatusSchema = z.enum(ids(MATCH_STATUSES));

export const matchUpdateSchema = z.object({
  type: z.enum(ids(MATCH_UPDATE_TYPES)),
  team: z.enum(['home', 'away']).nullable(),
  minute: z.number().int().min(0).max(130).nullable(),
  text: z.string().transform(cleanSingleLine).pipe(z.string().max(EXTRA_LIMITS.matchUpdateMax)),
});
export type MatchUpdateInput = z.infer<typeof matchUpdateSchema>;

export const feedbackSchema = z.object({
  text: z.string().transform(cleanMultiline).pipe(z.string().min(3, 'Tell us a little more').max(EXTRA_LIMITS.feedbackMax)),
});
