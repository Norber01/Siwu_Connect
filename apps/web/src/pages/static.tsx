import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MIN_AGE } from '@siwu/shared';

function DraftNotice() {
  return (
    <p className="mb-6 rounded-xl border border-gold-400/50 bg-gold-100 px-4 py-3 text-sm text-gold-800">
      Draft — awaiting approval by the Siwu Connect founders before public launch.
    </p>
  );
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="prose-sm pb-8 text-gray-800 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:space-y-1">
      <h1 className="mb-4 text-2xl font-bold text-gray-900">{title}</h1>
      <DraftNotice />
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
      <p>This notice explains what information Siwu Connect collects and how it is used.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address (or Google account) to sign you in. Your email is never shown publicly.</li>
        <li><strong>Profile:</strong> display name, username, hometown, optional photo, and — only if you choose — where you live now and your country. These are visible to signed-in members.</li>
        <li><strong>Content:</strong> posts, comments, likes and reports you make.</li>
        <li><strong>Records:</strong> the date you accepted the community rules and confirmed your age, and logs of moderation actions.</li>
      </ul>
      <h2>What we do not collect</h2>
      <ul>
        <li>We do not track your GPS location.</li>
        <li>We do not sell your information or show third-party advertising.</li>
      </ul>
      <h2>Where it is stored</h2>
      <p>
        Data is stored with Google Firebase (authentication and database) and Cloudflare (website hosting and profile
        photos). These providers may store data outside Ghana.
      </p>
      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile at any time in Settings.</li>
        <li>Delete your account in Settings. This removes your profile and erases the text of your posts and comments.</li>
      </ul>
      <h2>Contact</h2>
      <p>Contact details for privacy questions will be added before public launch.</p>
    </Doc>
  );
}
