import { Button } from "@/components/Button";

export default function NotFound() {
  return (
    <header className="phead">
      <h1>We can&apos;t find that page.</h1>
      <div className="ctas"><Button href="/">Go home</Button></div>
    </header>
  );
}
