import Link from "next/link";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { NetSwitch } from "./NetSwitch";

export function SiteNav() {
  return (
    <nav className="nav" aria-label="Main">
      <Logo />
      <div className="links">
        <Link href="/#live">Pledges</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/make">For funders</Link>
      </div>
      <div className="navr">
        <NetSwitch />
        <Button href="/make" size="sm">Make a pledge</Button>
      </div>
    </nav>
  );
}
