import Link from "next/link";

/** P + coin mark. Drawn in CSS (.mark::before / ::after). */
export function Logo({ small }: { small?: boolean }) {
  return (
    <Link className="logo" href="/" aria-label="Pledger home">
      <span className={small ? "mark small" : "mark"} aria-hidden="true" />
      Pledger
    </Link>
  );
}
