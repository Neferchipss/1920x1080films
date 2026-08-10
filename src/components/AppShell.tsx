"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { JourneyProvider } from "@/context/JourneyContext";
import { NodeId } from "@/lib/journey";
import Ribbon from "@/components/Ribbon";
import CustomCursor from "@/components/CustomCursor";

const ROUTE_NODE: Record<string, NodeId> = {
  "/about": "about",
  "/portfolio": "portfolio",
  "/contact": "contact",
  "/services": "services",
  "/studio": "studio",
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const initialTarget = ROUTE_NODE[pathname];

  return (
    <JourneyProvider initialTarget={initialTarget}>
      <CustomCursor />
      <Ribbon />
      {children}
    </JourneyProvider>
  );
}
