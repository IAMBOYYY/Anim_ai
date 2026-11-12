"use client";

import { Workspace } from "@/components/workspace/workspace";
import { WorkspaceProvider } from "@/components/workspace/store";

export default function HomePage() {
  return (
    <WorkspaceProvider>
      <Workspace />
    </WorkspaceProvider>
  );
}
