import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  // Agency fork: the projects list is the home after sign-in (lib/projects).
  redirect(session ? "/projects" : "/login");
}
