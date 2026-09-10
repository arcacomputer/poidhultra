import '@/styles/ultra.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/ultra/providers';
import { Shell } from '@/components/ultra/shell';
const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://poidh.arca.computer';
export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: 'poidh Ultra — Make it happen.',
    template: '%s · poidh Ultra',
  },
  description:
    'Create a bounty. Make something happen. Reward the proof. Open-source social bounties on Ethereum, Base, and Arbitrum.',
  openGraph: { images: ['/images/poidh-preview-hero-v2.png'] },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fafaf6',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
