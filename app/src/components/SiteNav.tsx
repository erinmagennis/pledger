import Link from "next/link";
import { Button } from "./Button";
import { Icon } from "./Icons";
import { Logo } from "./Logo";

export function SiteNav() {
  return (
    <nav className="nav" aria-label="Main">
      <Logo />
      <div className="links">
        <Link href="/#live">Pledges</Link>
        <Link href="/#how">How it works</Link>
        <Link href="/#funders">For funders</Link>
      </div>
      <div className="navr">
        <span className="lang"><Icon name="globe" />EN</span>
        <Button href="/#make" size="sm">Make a pledge</Button>
      </div>
    </nav>
  );
}
