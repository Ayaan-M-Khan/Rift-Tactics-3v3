import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: "Rift Tactics - Summoner's Mid Lane 3v3",
  description: "A turn-based multiplayer tactical combat game set in Summoner's Rift Mid Lane featuring 3v3 champion draft, tactical grid combat, turrets, minions, and shop system.",
  openGraph: {
    title: "Rift Tactics - Summoner's Mid Lane 3v3",
    description: "A turn-based multiplayer tactical combat game set in Summoner's Rift Mid Lane featuring 3v3 champion draft, tactical grid combat, turrets, minions, and shop system.",
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Rift Tactics - Summoner's Mid Lane 3v3",
    description: "A turn-based multiplayer tactical combat game set in Summoner's Rift Mid Lane featuring 3v3 champion draft, tactical grid combat, turrets, minions, and shop system.",
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
