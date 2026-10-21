import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSiteHost } from "@/lib/hosts";
import { Landing } from "./(site)/landing";
import { SiteShell } from "./(site)/shell";

export async function generateMetadata(): Promise<Metadata> {
  if (!isSiteHost((await headers()).get("host"))) return {};
  return {
    title: "CareHouse One · Care records for group homes",
    description: "Medication pass, vital signs, progress notes and shift sign-in on one shared tablet per home. $149 per home per month.",
    robots: { index: true, follow: true },
  };
}

/** www.carehouseone.com shows the landing page; the app's own address goes straight to the app. */
export default async function Home() {
  if (!isSiteHost((await headers()).get("host"))) redirect(process.env.DEMO_MODE === "true" ? "/demo" : "/dashboard");
  return (
    <SiteShell>
      <Landing />
    </SiteShell>
  );
}
