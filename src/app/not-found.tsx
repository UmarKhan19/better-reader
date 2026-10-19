import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not found, Better Reader",
  description: "This page does not exist.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-library-background px-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-stamp text-library-subtle">
        Better Reader
      </p>
      <h1 className="text-2xl font-semibold tracking-tight text-library-foreground">
        This page doesn&apos;t exist
      </h1>
      <p className="max-w-sm text-sm text-library-caption">
        The document may have been deleted, or the link may be wrong. Your library is still where you left it.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-11 items-center rounded-lg bg-library-foreground px-5 text-sm font-medium text-library-inverse transition-colors hover:bg-library-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Back to library
      </Link>
    </main>
  );
}
