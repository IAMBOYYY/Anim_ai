import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid h-dvh place-items-center bg-background p-6 text-center">
      <div>
        <p className="text-4xl font-black text-gradient">404</p>
        <p className="mt-2 text-sm text-muted-foreground">This tab doesn’t exist.</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to workspace
        </Link>
      </div>
    </div>
  );
}
