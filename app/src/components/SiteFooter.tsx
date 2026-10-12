import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <>
      <div className="ground" />
      <footer className="footer">
        <Logo small />
        <span>Part of ImpactHook · <a href="/terms">Terms</a></span>
      </footer>
    </>
  );
}
