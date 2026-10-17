import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not found — Better Kindle",
  description: "This page does not exist.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        Better Kindle
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        This page doesn&apos;t exist
      </h1>
      <p className="max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        The document may have been deleted, or the link may be wrong. Your library is still where you left it.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-11 items-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Back to library
      </Link>
    </main>
  );
}
