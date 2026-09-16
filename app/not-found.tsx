import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#050c12] text-[#f0e6d2] flex flex-col items-center justify-center p-4">
      <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
      <p className="text-zinc-400 mb-4">Could not find requested resource</p>
      <Link href="/" className="px-4 py-2 bg-[#c8aa6e] text-black font-semibold rounded">
        Return to Mid Lane
      </Link>
    </div>
  );
}
