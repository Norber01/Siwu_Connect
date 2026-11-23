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

export const postTextSchema = z
  .string()
  .transform(cleanMultiline)
  .pipe(
    z
      .string()
      .min(1, 'Write something first')
      .max(LIMITS.postMaxChars, `Posts can be at most ${LIMITS.postMaxChars} characters`),
  );

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
  .refine((v) => v.role === 'super_admin' || v.townIds.length > 0, {
    message: 'Choose at least one town for this role',
    path: ['townIds'],
  });
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;
