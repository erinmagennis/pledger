import { notFound, redirect } from "next/navigation";

// The line now lives on the pledge page itself. Old links land on its line section.
export default async function LinePage({ params }: { params: Promise<{ slug: string }> }) {
  // Only the Artizen give-back takes claims for now.
  if ((await params).slug !== "artizen") notFound();
  redirect("/pledges/artizen#line");
}
