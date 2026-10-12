import Link from "next/link";
import { Icon } from "./Icons";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
};

/** Pill button. Primary carries the arrow circle, as in the design. */
export function Button({ href, children, variant = "primary", size = "md" }: Props) {
  const cls = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : ""].join(" ").trim();
  return (
    <Link className={cls} href={href}>
      {children}
      {variant === "primary" && (
        <span className="arr">
          <Icon name="arrow" small={size === "sm"} />
        </span>
      )}
    </Link>
  );
}
