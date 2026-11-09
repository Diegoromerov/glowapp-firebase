"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Palette, Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const themes = [
  { value: "neutral", label: "Neutral", icon: Monitor, description: "Default dark theme" },
  { value: "tangerine", label: "Tangerine", icon: Sun, description: "Warm orange accents" },
  { value: "brutalist", label: "Brutalist", icon: Palette, description: "High contrast, no radius" },
  { value: "softpop", label: "Soft Pop", icon: Sun, description: "Light pastel theme" },
] as const;

export function ThemeSelector() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = React.useState(false);

  const currentTheme = themes.find(t => t.value === theme) || themes[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background",
          "hover:bg-accent hover:text-accent-foreground transition-colors",
          "text-sm font-medium"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <currentTheme.icon className="w-4 h-4" />
        <span>{currentTheme.label}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
            {themes.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setTheme(t.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  theme === t.value && "bg-accent text-accent-foreground"
                )}
                role="option"
                aria-selected={theme === t.value}
              >
                <t.icon className="w-4 h-4 shrink-0" />
                <div className="flex flex-col">
                  <span>{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </div>
                {theme === t.value && (
                  <svg className="w-4 h-4 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
