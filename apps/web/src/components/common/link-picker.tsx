import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "@/components/ui/command";

export type LinkPickerItem = {
  id: string;
  /** Text the input filters against; include every term worth searching by. */
  value: string;
  label: string;
  /** Short prefix such as an issue key, shown before the label. */
  hint?: string;
  icon?: ReactNode;
};

type LinkPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Candidates to link. Callers filter out what is already linked. */
  items: LinkPickerItem[];
  groupLabel: string;
  placeholder: string;
  emptyText: string;
  onSelect: (id: string) => void;
};

type LinkPickerGroup = {
  value: string;
  label: string;
  items: LinkPickerItem[];
};

/**
 * The search-and-pick dialog behind a "link something to this" button, modelled
 * on the one task relations use so linking reads the same wherever it appears.
 *
 * It knows nothing about what is being linked: callers hand it labelled items
 * and get back an id.
 */
export default function LinkPicker({
  open,
  onOpenChange,
  items,
  groupLabel,
  placeholder,
  emptyText,
  onSelect,
}: LinkPickerProps) {
  const groups = useMemo<LinkPickerGroup[]>(
    () => [{ value: "items", label: groupLabel, items }],
    [groupLabel, items],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <Command items={groups}>
          <CommandInput placeholder={placeholder} />
          <CommandPanel>
            <CommandEmpty>
              <p className="py-6 text-center text-muted-foreground text-sm">
                {emptyText}
              </p>
            </CommandEmpty>
            <CommandList>
              {(group: LinkPickerGroup) => (
                <CommandGroup key={group.value} items={group.items}>
                  <CommandGroupLabel>{group.label}</CommandGroupLabel>
                  <CommandCollection>
                    {(item: LinkPickerItem) => (
                      <CommandItem
                        key={item.id}
                        value={item.value}
                        onClick={() => onSelect(item.id)}
                        className="flex items-center gap-3 py-2"
                      >
                        {item.icon}
                        {item.hint && (
                          <span className="shrink-0 font-mono text-muted-foreground text-xs">
                            {item.hint}
                          </span>
                        )}
                        <span className="flex-1 truncate text-sm">
                          {item.label}
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              )}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
