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
        <Link href="/make">Make a pledge</Link>
      </div>
      <div className="navr">
        <NetSwitch />
        <Button href="/pledges/demo#try" size="sm">Try the demo</Button>
      </div>
    </nav>
  );
}
