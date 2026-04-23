import { create } from "zustand";

type WorkspaceTargetDisposition = "split-right" | "split-down";

type CommandPaletteOpenIntent =
  | {
      kind: "add-project";
      requestId: number;
    }
  | {
      kind: "workspace-target";
      requestId: number;
      disposition: WorkspaceTargetDisposition;
    };

interface CommandPaletteStore {
  open: boolean;
  openIntent: CommandPaletteOpenIntent | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: () => void;
  openWorkspaceTarget: (input: { disposition: WorkspaceTargetDisposition }) => void;
  clearOpenIntent: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openIntent: null,
  setOpen: (open) => set({ open, ...(open ? {} : { openIntent: null }) }),
  toggleOpen: () =>
    set((state) => ({ open: !state.open, ...(state.open ? { openIntent: null } : {}) })),
  openAddProject: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "add-project",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  openWorkspaceTarget: (input) =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "workspace-target",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
        disposition: input.disposition,
      },
    })),
  clearOpenIntent: () => set({ openIntent: null }),
}));
