'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import {
  Camera,
  ArrowUpRight,
  Plus,
  Bell,
  Menu,
  X,
  Wallet,
  LogOut,
} from 'lucide-react';
import { api, useSession } from './providers';
import { readOnlyPreview, upstreamPreview } from '@/utils/preview';
export const short = (address: string) =>
  address.slice(0, 6) + '…' + address.slice(-4);
export function WalletButton() {
  const account = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  if (readOnlyPreview) return <span className='chip'>Read-only preview</span>;
  return (
    <div className='wallet-control'>
      <button
        className='button button-dark'
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Wallet size={16} />
        {account.address ? short(account.address) : 'Connect wallet'}
      </button>
      {open && (
        <div className='wallet-menu'>
          {account.address ? (
            <>
              <Link
                onClick={() => setOpen(false)}
                href={'/account/' + account.address}
              >
                My profile
              </Link>
              <button
                onClick={async () => {
                  try {
                    await api.request('/auth/logout', { method: 'POST' });
                  } catch {}
                  disconnect();
                  setOpen(false);
                }}
              >
                <LogOut size={15} />
                Disconnect
              </button>
            </>
          ) : (
            <>
              <strong>Choose your wallet</strong>
              {connectors
                .filter((v, i, a) => a.findIndex((c) => c.id === v.id) === i)
                .map((c) => (
                  <button
                    disabled={isPending}
                    key={c.uid}
                    onClick={async () => {
                      try {
                        setError('');
                        await connectAsync({ connector: c });
                        setOpen(false);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              <p className='muted'>
                Use a wallet installed in this browser. On mobile, open poidh in
                your wallet’s browser.
              </p>
            </>
          )}
          {error && (
            <p role='alert' className='error'>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const links = [
    ['/', 'Bounties'],
    ['/explore', 'Discover'],
    ['/albums', 'Albums'],
    ['/leaderboard', 'Leaderboard'],
  ];
  return (
    <>
      <a className='skip-link' href='#main'>
        Skip to content
      </a>
      <header className='site-header'>
        <Link href='/' className='wordmark' aria-label='poidh Ultra home'>
          <Camera size={30} strokeWidth={2.4} />
          <span>
            poidh<span className='ultra-tag'>ULTRA</span>
          </span>
        </Link>
        <nav
          className={menu ? 'navigation open' : 'navigation'}
          aria-label='Main navigation'
        >
          {links.map(([href, label]) => (
            <Link
              key={href}
              onClick={() => setMenu(false)}
              aria-current={path === href ? 'page' : undefined}
              href={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className='header-actions'>
          <Link
            href='/notifications'
            className='icon-button'
            aria-label='Notifications'
          >
            <Bell size={20} />
          </Link>
          <WalletButton />
          <button
            className='icon-button mobile-menu'
            aria-label={menu ? 'Close menu' : 'Open menu'}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {readOnlyPreview && (
        <aside className='preview-banner' aria-label='Preview status'>
          <strong>poidh Ultra preview</strong> ·{' '}
          {upstreamPreview ? (
            <>
              Bounties and proofs from{' '}
              <a
                href='https://indexer.poidh.xyz/swagger'
                target='_blank'
                rel='noreferrer'
              >
                poidh’s public API
              </a>
              .{' '}
            </>
          ) : (
            <>Indexing and community migration are being prepared. </>
          )}
          Wallet transactions and community writes are disabled.{' '}
          <Link href='/maintenance'>View maintenance status ↗</Link>
        </aside>
      )}
      <main id='main'>{children}</main>
      <footer className='site-footer'>
        <div>
          <Link href='/' className='footer-logo'>
            pics or it didn’t happen.
          </Link>
          <p>Good ideas. Real action. Proof onchain.</p>
        </div>
        <div>
          <Link href='/maintenance'>Upstream status</Link>
          <Link href='https://docs.poidh.xyz/'>
            How poidh works <ArrowUpRight size={13} />
          </Link>
          <Link href='https://github.com/arcacomputer/poidhultra'>
            Open source <ArrowUpRight size={13} />
          </Link>
          <Link href='/terms'>Terms</Link>
        </div>
        <span className='footer-note'>Made for the things worth doing.</span>
      </footer>
    </>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className='notice error' role='alert'>
      <strong>Couldn’t load this just yet.</strong>
      <p>{error instanceof Error ? error.message : 'Please try again.'}</p>
      {retry && (
        <button className='button button-small' onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className='empty'>
      <Camera size={32} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
