import { redirect } from "next/navigation";

export default function ProjectRootPage({ params }: { params: { id: string } }) {
  redirect(`/projects/${params.id}/plan`);
}
