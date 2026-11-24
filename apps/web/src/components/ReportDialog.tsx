import { useState } from 'react';
import { LIMITS, REPORT_REASONS, reportSchema } from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { type ReportTarget, submitReport } from '../lib/ops';
import { friendlyError, isPermissionDenied } from '../lib/util';
import { useToast } from './Toast';
import { Alert, Button, Modal, TextArea } from './ui';

const nouns = { post: 'post', comment: 'comment', user: 'user', event: 'event', listing: 'listing', message: 'message' } as const;

export function ReportDialog({ target, open, onClose }: { target: ReportTarget; open: boolean; onClose: () => void }) {
  const { user, profile } = useMe();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = reportSchema.safeParse({ targetType: target.targetType, reason, details });
    if (!parsed.success) {
      setError('Choose a reason for your report.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitReport(db, user.uid, target, parsed.data.reason, parsed.data.details);
      toast('Thank you. A moderator will review your report.');
      setReason('');
      setDetails('');
      onClose();
    } catch (err) {
      if (isPermissionDenied(err) && profile.status === 'active') setError('You have already reported this.');
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Report this ${nouns[target.targetType]}`}>
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm text-gray-700">What is the problem?</legend>
          <div className="space-y-1">
            {REPORT_REASONS.map((r) => (
              <label key={r.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-sand-100">
                <input
                  type="radio"
                  name="reason"
                  value={r.id}
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                  className="h-4 w-4 accent-brand-800"
                />
                <span className="text-sm">{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextArea
          label="More details (optional)"
          rows={3}
          maxLength={LIMITS.reportDetailsMax}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Send report
          </Button>
        </div>
      </form>
    </Modal>
  );
}
