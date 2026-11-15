import { redirect } from "next/navigation";

// Portfolio is home. The app layout sends a visitor without a profile to onboarding first.
export default function Home() {
    redirect('/portfolio');
}
