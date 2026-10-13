import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <>
      <div className="ground" />
      <footer className="footer">
        <Logo small />
        <span>Made by <a href="https://erinmagennis.com" target="_blank" rel="noreferrer">Erin Magennis</a> · <a href="/terms">Terms</a></span>
      </footer>
    </>
  );
}
