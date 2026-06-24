import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "success"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95",
  success:
    "bg-success text-success-foreground shadow-sm hover:bg-success/90 active:bg-success/95",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/70 border border-border",
  outline:
    "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
  ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
  destructive:
    "border border-red-200 bg-white text-red-600 hover:bg-red-50 active:bg-red-100",
  subtle: "bg-muted text-muted-foreground hover:bg-muted/70",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
