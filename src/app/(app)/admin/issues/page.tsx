import { redirect } from "next/navigation";

// Stage 8 issue flags became disputes in Stage 10.
export default function AdminIssuesPage() {
  redirect("/admin/disputes");
}
