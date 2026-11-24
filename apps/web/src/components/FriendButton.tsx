import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../auth/AuthProvider';
import { db } from '../lib/firebase';
import { useFriendships } from '../lib/friends';
import { acceptFriendRequest, openDm, removeFriendship, sendFriendRequest } from '../lib/ops';
import { friendlyError } from '../lib/util';
import { useToast } from './Toast';
import { Button, Modal } from './ui';

/**
 * Add friend → Requested → Friends. Friends can chat privately and see each other's stories.
 * Shows "Message" once you are friends.
 */
export function FriendActions({ uid, name, small = true }: { uid: string; name: string; small?: boolean }) {
  const { user, profile } = useMe();
  const f = useFriendships();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const rel = f.get(uid);
  const first = name.split(' ')[0];

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (uid === user.uid || f.loading) return null;
  const active = profile.status === 'active';

  if (!rel)
    return (
      <Button small={small} icon="plus" busy={busy} disabled={!active} onClick={() => act(() => sendFriendRequest(db, user.uid, uid), `Friend request sent to ${first}.`)}>
        Add friend
      </Button>
    );
  if (rel.status === 'pending' && rel.incoming)
    return (
      <>
        <Button small={small} icon="check" busy={busy} disabled={!active} onClick={() => act(() => acceptFriendRequest(db, user.uid, uid), `You and ${first} are now friends 🎉`)}>
          Accept request
        </Button>
        <Button small={small} variant="secondary" disabled={busy} onClick={() => act(() => removeFriendship(db, user.uid, uid), 'Request declined.')}>
          Decline
        </Button>
      </>
    );
  if (rel.status === 'pending')
    return (
      <Button small={small} variant="secondary" busy={busy} onClick={() => act(() => removeFriendship(db, user.uid, uid), 'Request cancelled.')}>
        Requested · Cancel
      </Button>
    );
  return (
    <>
      <Button
        small={small}
        icon="message"
        disabled={busy || !active}
        onClick={() => act(async () => navigate(`/chat/${await openDm(db, user.uid, uid)}`))}
      >
        Message
      </Button>
      <Button small={small} variant="secondary" icon="check" onClick={() => setConfirm(true)}>
        Friends
      </Button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Unfriend ${first}?`}>
        <p className="text-sm text-gray-700">You will no longer be able to message each other or see each other's stories.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() =>
              act(async () => {
                await removeFriendship(db, user.uid, uid);
                setConfirm(false);
              }, `You unfriended ${first}.`)
            }
          >
            Unfriend
          </Button>
        </div>
      </Modal>
    </>
  );
}
