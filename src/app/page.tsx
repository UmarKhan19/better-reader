import type { Metadata } from "next";
import { Library } from "@/components/library";

export const metadata: Metadata = {
  title: "Library, Better Reader",
  description: "Your personal PDF library.",
};

export default function HomePage() {
  return <Library />;
}
