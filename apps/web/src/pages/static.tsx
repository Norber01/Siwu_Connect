import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MIN_AGE } from '@siwu/shared';

/** Contact for privacy questions and account deletion requests (forwarded to the founders). */
export const PRIVACY_EMAIL = 'privacy@siwuconnect.com';
const UPDATED = '25 November 2026';

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="prose-sm pb-8 text-gray-800 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:space-y-1">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mb-4 text-xs text-gray-600">Last updated {UPDATED}</p>
      {children}
      <p className="mt-8">
        <Link to="/" className="font-medium text-brand-800 underline">
          Back to Siwu Connect
        </Link>
      </p>
    </article>
  );
}

export function RulesPage() {
  return (
    <Doc title="Community rules">
      <p>
        Siwu Connect is a shared space for the people of Akpafu Odomi, Akpafu Mempeasem, Akpafu Todzi, Akpafu Adokor and Akpafu Sokpo —
        at home, across Ghana and abroad. Treat others as you would at a gathering in your own town.
      </p>
      <h2>Not allowed</h2>
      <ul>
        <li><strong>Harassment and bullying</strong> — insulting, intimidating or repeatedly targeting anyone.</li>
        <li><strong>Threats and violence</strong> — threatening or encouraging harm to people, families or towns.</li>
        <li><strong>Impersonation</strong> — pretending to be another person, chief, church, group or official body.</li>
        <li><strong>Spam and scams</strong> — repeated adverts, chain messages, fake offers or requests for money.</li>
        <li><strong>Misinformation</strong> — sharing claims you know or suspect are false, especially about deaths, health or safety.</li>
        <li><strong>Defamation</strong> — damaging someone's reputation with untrue statements.</li>
        <li><strong>Fraud</strong> — deceiving people for money or personal gain.</li>
        <li>Sharing other people's private information (phone numbers, addresses) without their permission.</li>
      </ul>
      <h2>Good practice</h2>
      <ul>
        <li>Post in the town your news is about, so people know where information comes from.</li>
        <li>Be careful with funeral and emergency news — confirm with the family or officials first.</li>
        <li>Disagree respectfully. Debate ideas, not people.</li>
      </ul>
      <h2>Reporting and moderation</h2>
      <p>
        Use <strong>Report</strong> on any post, comment or profile that breaks these rules. Moderators review reports and
        may remove content or suspend accounts. You can also block someone so you no longer see their posts and comments.
      </p>
      <h2>Who can join</h2>
      <p>You must be at least {MIN_AGE} years old to use Siwu Connect.</p>
    </Doc>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Privacy notice">
      <p>
        Siwu Connect is a community app for the people of Akpafu Odomi, Mempeasem, Todzi, Adokor and Sokpo, run by the Siwu
        Connect founders. This notice explains what information the app collects, why, and the choices you have.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address (or Google account) to sign you in. Your email is never shown to other members.</li>
        <li><strong>Profile:</strong> name, username, hometown and, if you add them, a photo, a short bio, where you live now, your birthday (day and month only) and "I'm home" visits. These are visible to signed-in members.</li>
        <li><strong>What you share:</strong> posts, photos, videos, stories, comments, reactions, polls, events, marketplace and business listings, predictions and event photos.</li>
        <li><strong>Messages:</strong> private and group chat messages, photos and voice notes. Private messages can only be read by the people in the chat — not by other members and not by admins. Messages in town chats are visible to all members.</li>
        <li><strong>Friends and activity:</strong> who you are friends with, who viewed your stories, and when you were last active (you can hide this in Settings → Privacy).</li>
        <li><strong>Notifications:</strong> if you turn notifications on, a notification address for that phone or computer (given by Google, Apple, Mozilla or Microsoft, whose service delivers them) and your choice of which notifications you want. Notifications are encrypted so only your device can read them.</li>
        <li><strong>Safety records:</strong> when you accepted the community rules and confirmed your age, reports you make, and records of moderation actions.</li>
      </ul>
      <h2>What we do not collect</h2>
      <ul>
        <li>We do not track your location. The microphone is only used when you record a voice note; the camera only when you choose to take a photo or video.</li>
        <li>We do not sell your information, and there is no third-party advertising or tracking.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>Only to run the app: to sign you in, show your posts and messages to the right people, keep the community safe (reports and moderation), and fix problems you tell us about.</p>
      <h2>Where it is stored</h2>
      <p>
        Data is stored with Google Firebase (sign-in and database) and Cloudflare (website, photos, videos, voice notes and
        nightly backups). These providers may store data outside Ghana. Connections are encrypted.
      </p>
      <h2>How long we keep it</h2>
      <ul>
        <li>Stories disappear after 24 hours. Everything else stays until you delete it or delete your account.</li>
        <li>A device's notification address is removed when you turn notifications off, sign out on that device, or uninstall the app.</li>
        <li>Backups are kept for 14 days, so deleted information disappears from backups within 14 days.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile, hide your activity status or stop sharing your birthday at any time in Settings.</li>
        <li>Delete posts, messages and stories you made.</li>
        <li>
          Delete your account in Settings → Delete account. See <Link to="/delete-account" className="underline">how account deletion works</Link>.
        </li>
      </ul>
      <h2>Children</h2>
      <p>You must be at least {MIN_AGE} years old to use Siwu Connect.</p>
      <h2>Contact</h2>
      <p>
        Questions or requests about your information: <a className="underline" href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
      </p>
    </Doc>
  );
}

/** Public page (no sign-in needed) explaining how to delete an account — required by app stores. */
export function DeleteAccountPage() {
  return (
    <Doc title="Delete your Siwu Connect account">
      <h2>In the app</h2>
      <ol className="ml-5 mt-2 list-decimal space-y-1">
        <li>Open Siwu Connect and sign in.</li>
        <li>Tap <strong>More → Settings</strong>.</li>
        <li>Scroll down and tap <strong>Delete account</strong>, type your username to confirm, and tap Delete.</li>
      </ol>
      <h2>If you can't sign in</h2>
      <p>
        Email <a className="underline" href={`mailto:${PRIVACY_EMAIL}?subject=Delete%20my%20Siwu%20Connect%20account`}>{PRIVACY_EMAIL}</a> from
        the email address you signed up with, with the subject "Delete my account" and your username. We will delete it within 30 days and confirm by email.
      </p>
      <h2>What is deleted</h2>
      <ul>
        <li>Your profile, username, photo, sign-in account, friends, saved posts, notifications, notification settings and devices, and blocks.</li>
        <li>The text, photos, videos and voice notes of your posts, comments, stories, chat messages, events, listings and event photos.</li>
        <li>You leave all group chats.</li>
      </ul>
      <h2>What is kept</h2>
      <ul>
        <li>Like, RSVP and vote totals stay as anonymous numbers.</li>
        <li>Records of moderation actions are kept for community safety.</li>
        <li>Backups are kept for 14 days, then your data is gone from them too.</li>
      </ul>
    </Doc>
  );
}
