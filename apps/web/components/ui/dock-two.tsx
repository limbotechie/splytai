"use client";

import * as React from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { LucideIcon } from "lucide-react"

interface DockProps {
  className?: string
  items: {
    icon: LucideIcon
    label: string
    onClick?: () => void
    active?: boolean
    className?: string
    iconClassName?: string
  }[]
}

interface DockIconButtonProps {
  icon: LucideIcon
  label: string
  onClick?: () => void
  className?: string
  active?: boolean
  iconClassName?: string
}

const DockIconButton = React.forwardRef<HTMLButtonElement, DockIconButtonProps>(
  ({ icon: Icon, label, onClick, className, active, iconClassName }, ref) => {
    return (
      <motion.button
        ref={ref}
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={cn(
          "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-1.5 py-2 text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          active ? "bg-muted text-foreground" : "hover:bg-muted/70 hover:text-foreground",
          className
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", iconClassName)} aria-hidden />
        <span className="text-[10px] leading-tight font-medium sm:text-[11px]">
          {label}
        </span>
      </motion.button>
    )
  }
)
DockIconButton.displayName = "DockIconButton"

const Dock = React.forwardRef<HTMLDivElement, DockProps>(
  ({ items, className }, ref) => {
    return (
      <div ref={ref} className={cn(className)}>
        <motion.div
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded-full border border-border bg-background/90 p-1.5 shadow-[0_8px_40px_rgb(0_0_0/0.18)] backdrop-blur-xl"
          )}
        >
          {items.map((item) => (
            <DockIconButton key={item.label} {...item} />
          ))}
        </motion.div>
      </div>
    )
  }
)
Dock.displayName = "Dock"

export { Dock }
