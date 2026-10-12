import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <>
      <div className="ground">Footer art: grass, flowers, a bush, a small animal (Higgsfield)</div>
      <footer className="footer">
        <Logo small />
        <span>Part of ImpactHook</span>
      </footer>
    </>
  );
}
