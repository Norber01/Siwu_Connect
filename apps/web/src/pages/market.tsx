import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXTRA_LIMITS,
  LISTING_CATEGORIES,
  TOWNS,
  type TownId,
  canModerate,
  isTownId,
  listingSchema,
  townShortName,
} from '@siwu/shared';
import { useMe } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { db } from '../lib/firebase';
import { createListing, setListingStatus, updateListing } from '../lib/ops';
import { fetchListing, fetchListings } from '../lib/queries';
import type { Listing } from '../lib/types';
import { formatPrice, friendlyError, isPermissionDenied, timeAgo, whatsappLink } from '../lib/util';
import { PhotoField } from '../components/extras';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Menu';
import { AuthorLine, RichText } from '../components/PostCard';
import { ReportDialog } from '../components/ReportDialog';
import { TownChips } from '../components/TownChips';
import { useToast } from '../components/Toast';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageSpinner,
  SelectField,
  TextArea,
  TextField,
} from '../components/ui';
import { HubTabs } from './events';

const categoryLabel = (id: string) => LISTING_CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';

export function MarketPage() {
  const [params, setParams] = useSearchParams();
  const town = isTownId(params.get('town')) ? params.get('town')! : 'all';
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['listings', town], queryFn: () => fetchListings(town === 'all' ? null : town), staleTime: 60_000 });
  const term = search.trim().toLowerCase();
  const items = (q.data ?? []).filter(
    (l) => (!category || l.category === category) && (!term || `${l.title} ${l.description}`.toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-3">
      <HubTabs />
      <TownChips value={town} onChange={(v) => setParams(v === 'all' ? {} : { town: v }, { replace: true })} />
      <div className="flex gap-2">
        <TextField label="Search the marketplace" className="flex-1 [&_label]:sr-only" type="search" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Link to="/market/new" className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
          <Icon name="plus" className="h-4 w-4" /> Sell
        </Link>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {[{ id: '', label: 'All items' }, ...LISTING_CATEGORIES].map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            aria-pressed={category === c.id}
            className={`min-h-[36px] shrink-0 rounded-full px-3 text-xs font-semibold ${
              category === c.id ? 'bg-gold-400 text-[#0d4a1e]' : 'bg-white text-gray-700 ring-1 ring-sand-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="rounded-xl bg-gold-100 px-3 py-2 text-xs text-gold-800">
        Siwu Connect does not handle payments. Meet in a safe place, check items before you pay, and never send money
        in advance to someone you don't know.
      </p>
      {q.isPending ? (
        <PageSpinner />
      ) : q.isError ? (
        <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing for sale here yet" icon="cart">
          Sell farm produce, clothing, phones or your services to the community. Tap “Sell” to list something.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((l) => (
            <li key={l.id}>
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingCard({ listing: l }: { listing: Listing }) {
  return (
    <Link to={`/market/${l.id}`} className="block h-full overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm hover:border-brand-300">
      {l.imageUrl ? (
        <img src={l.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-brand-50 text-brand-300">
          <Icon name="cart" className="h-12 w-12" />
        </div>
      )}
      <div className="p-2.5">
        <p className="line-clamp-2 text-sm font-bold text-gray-900">{l.title}</p>
        <p className="mt-0.5 text-sm font-black text-brand-700">{formatPrice(l.price, l.priceUnit)}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
          <Icon name="location" className="h-3.5 w-3.5" /> Akpafu {townShortName(l.townId)}
        </p>
      </div>
    </Link>
  );
}

export function ListingDetailPage() {
  const { listingId = '' } = useParams();
  const { user, profile, role } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['listing', listingId], queryFn: () => fetchListing(listingId) });
  const [reporting, setReporting] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'remove'>(null);

  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const l = q.data;
  if (!l || l.status === 'deleted') return <EmptyState title="This listing is no longer available" icon="cart" />;
  const mine = l.sellerId === user.uid;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['listings'] });
    void q.refetch();
  };
  const toggleSold = async () => {
    try {
      await setListingStatus(db, l.id, l.status === 'sold' ? 'available' : 'sold');
      toast(l.status === 'sold' ? 'Listing is available again.' : 'Marked as sold. Congratulations!');
      refresh();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  const run = async () => {
    try {
      if (confirm === 'remove') await api(`/admin/listings/${l.id}/remove`, { json: { note: '' } });
      else await setListingStatus(db, l.id, 'deleted');
      toast('Listing removed.');
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: ['listings'] });
      navigate('/market');
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const items: MenuItem[] = [];
  if (mine && l.status !== 'removed') {
    items.push({ label: 'Edit listing', icon: 'edit', onSelect: () => navigate(`/market/${l.id}/edit`) });
    items.push({ label: l.status === 'sold' ? 'Mark as available' : 'Mark as sold', icon: 'check', onSelect: toggleSold });
  }
  if (mine) items.push({ label: 'Delete listing', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') });
  if (!mine && profile.status === 'active') items.push({ label: 'Report listing', icon: 'flag', onSelect: () => setReporting(true) });
  if (!mine && l.status !== 'removed' && canModerate(role, l.townId))
    items.push({ label: 'Remove listing (moderator)', icon: 'shield', danger: true, onSelect: () => setConfirm('remove') });

  const message = `Hello, I saw your "${l.title}" on Siwu Connect. Is it still available?`;

  return (
    <div className="space-y-4">
      <PageHeader title="Marketplace" back actions={<Menu items={items} label="Listing actions" />} />
      {l.status === 'removed' && <Alert kind="warning">This listing was removed by a moderator.</Alert>}
      <article className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
        {l.imageUrl && <img src={l.imageUrl} alt="" className="max-h-96 w-full object-cover" />}
        <div className="space-y-3 p-4">
          <div>
            {l.status === 'sold' && <span className="mb-1 inline-block rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">SOLD</span>}
            <h1 className="text-xl font-bold text-gray-900">{l.title}</h1>
            <p className="text-2xl font-black text-brand-700">{formatPrice(l.price, l.priceUnit)}</p>
            <p className="mt-1 text-sm text-gray-600">
              {categoryLabel(l.category)} · Akpafu {townShortName(l.townId)} · listed {timeAgo(l.createdAt)}
            </p>
          </div>
          {l.description && <RichText text={l.description} />}
          <div className="border-t border-sand-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Seller</p>
            <AuthorLine uid={l.sellerId} date={l.createdAt} />
          </div>
        </div>
        {!mine && l.status === 'available' && (
          <div className="space-y-2 border-t border-sand-200 p-3">
            {l.contactPhone ? (
              <div className="grid grid-cols-2 gap-2">
                {l.contactWhatsApp && (
                  <a
                    href={whatsappLink(l.contactPhone, message)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-600 font-bold text-white hover:bg-brand-700"
                  >
                    <Icon name="message" /> WhatsApp
                  </a>
                )}
                <a
                  href={`tel:${l.contactPhone}`}
                  className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-brand-600 font-bold text-brand-700 hover:bg-brand-50 ${l.contactWhatsApp ? '' : 'col-span-2'}`}
                >
                  <Icon name="phone" /> Call seller
                </a>
              </div>
            ) : (
              <p className="text-sm text-gray-700">The seller did not share a phone number. Open their profile and comment on one of their posts, or ask in your town feed.</p>
            )}
          </div>
        )}
        {mine && l.status !== 'removed' && (
          <div className="grid grid-cols-2 gap-2 border-t border-sand-200 p-3">
            <Button variant="secondary" icon="edit" onClick={() => navigate(`/market/${l.id}/edit`)}>
              Edit
            </Button>
            <Button icon="check" onClick={toggleSold}>
              {l.status === 'sold' ? 'Mark available' : 'Mark as sold'}
            </Button>
          </div>
        )}
      </article>
      <p className="rounded-xl bg-gold-100 px-3 py-2 text-xs text-gold-800">
        Stay safe: meet in a public place, inspect before paying, and never pay in advance to someone you don't know.
      </p>

      <ReportDialog open={reporting} onClose={() => setReporting(false)} target={{ targetType: 'listing', targetId: l.id, targetPath: `listings/${l.id}`, townId: l.townId }} />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'delete' ? 'Delete this listing?' : 'Remove this listing?'}>
        <p className="text-sm text-gray-700">
          {confirm === 'delete' ? 'It will disappear from the marketplace.' : 'It will be hidden from everyone. This is recorded in the audit log.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={run}>
            {confirm === 'delete' ? 'Delete' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function ListingFormPage() {
  const { listingId } = useParams();
  const editing = !!listingId;
  const { user, profile } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['listing', listingId, 'edit'], queryFn: () => fetchListing(listingId!), enabled: editing });

  const [townId, setTownId] = useState<TownId>(profile.hometownId as TownId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('food');
  const [price, setPrice] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsApp, setWhatsApp] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l = existing.data;
    if (!l) return;
    setTownId(l.townId as TownId);
    setTitle(l.title);
    setCategory(l.category);
    setPrice(l.price === null ? '' : String(l.price));
    setPriceUnit(l.priceUnit);
    setDescription(l.description);
    setPhone(l.contactPhone ?? '');
    setWhatsApp(l.contactWhatsApp);
    setImageUrl(l.imageUrl);
  }, [existing.data]);

  if (profile.status !== 'active') return <EmptyState title="Unavailable while suspended" icon="ban" />;
  if (editing && existing.isPending) return <PageSpinner />;
  if (editing && (!existing.data || existing.data.sellerId !== user.uid)) return <EmptyState title="You can only edit your own listings" icon="ban" />;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = listingSchema.safeParse({
      townId,
      title,
      category,
      description,
      price: price.trim() === '' ? null : Number(price),
      priceUnit,
      contactPhone: phone.trim() === '' ? null : phone,
      contactWhatsApp: whatsApp,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let id = listingId;
      if (editing) {
        const status = existing.data!.status === 'sold' ? 'sold' : 'available';
        await updateListing(db, listingId!, parsed.data, imageUrl, status);
      } else {
        id = await createListing(db, user.uid, parsed.data, imageUrl);
      }
      void qc.invalidateQueries({ queryKey: ['listings'] });
      void qc.invalidateQueries({ queryKey: ['listing', id] });
      toast(editing ? 'Listing updated.' : 'Your item is listed in the marketplace.');
      navigate(`/market/${id}`, { replace: true });
    } catch (err) {
      setError(isPermissionDenied(err) && !editing ? 'You can add one listing per minute. Please wait and try again.' : friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={editing ? 'Edit listing' : 'Sell something'} back />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <PhotoField url={imageUrl} onChange={setImageUrl} label="Photo (recommended)" />
        <TextField label="What are you selling?" maxLength={EXTRA_LIMITS.listingTitleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fresh tomatoes" />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {LISTING_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Town" value={townId} onChange={(e) => setTownId(e.target.value as TownId)}>
            {TOWNS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.shortName}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Price in GH₵" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ''))} hint="Leave empty for “contact for price”, 0 for free." />
          <TextField label="Per (optional)" maxLength={EXTRA_LIMITS.priceUnitMax} value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="basket, bag, hour…" />
        </div>
        <TextArea label="Description (optional)" rows={4} maxLength={EXTRA_LIMITS.listingDescriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="rounded-2xl border border-sand-200 bg-white p-4">
          <TextField label="Phone number for buyers (optional)" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 123 4567" hint="Visible to signed-in members on this listing only." />
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input type="checkbox" checked={whatsApp} onChange={(e) => setWhatsApp(e.target.checked)} className="h-5 w-5 accent-brand-700" />
            Buyers can message me on WhatsApp
          </label>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {editing ? 'Save changes' : 'List item'}
          </Button>
        </div>
      </form>
    </div>
  );
}
