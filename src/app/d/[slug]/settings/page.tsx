import { redirect } from "next/navigation";

export default async function SettingsHome({ params }: { params: Promise<{ slug: string }> }) {
  redirect(`/d/${(await params).slug}/settings/people`);
}
