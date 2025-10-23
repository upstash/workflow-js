import { cn } from "@/lib/utils"
import { ComponentProps } from "react"

export const MarkdownH1 = ({ className, children, ...props }: ComponentProps<"h1">) => (
  <h1
    className={cn(
      "text-2xl font-bold text-white mb-4 mt-6 first:mt-0",
      "border-b border-neutral-700 pb-2",
      "font-sans tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h1>
)

export const MarkdownH2 = ({ className, children, ...props }: ComponentProps<"h2">) => (
  <h2
    className={cn(
      "text-xl font-semibold text-white mb-3 mt-5 first:mt-0",
      "border-b border-neutral-800 pb-1.5",
      "font-sans tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h2>
)

export const MarkdownH3 = ({ className, children, ...props }: ComponentProps<"h3">) => (
  <h3
    className={cn(
      "text-lg font-medium text-white mb-2 mt-4 first:mt-0",
      "font-sans tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h3>
)

export const MarkdownH4 = ({ className, children, ...props }: ComponentProps<"h4">) => (
  <h4
    className={cn(
      "text-base font-medium text-neutral-200 mb-2 mt-3 first:mt-0",
      "font-sans tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h4>
)

export const MarkdownH5 = ({ className, children, ...props }: ComponentProps<"h5">) => (
  <h5
    className={cn(
      "text-sm font-medium text-neutral-300 mb-1.5 mt-3 first:mt-0",
      "font-sans tracking-tight uppercase",
      className
    )}
    {...props}
  >
    {children}
  </h5>
)

export const MarkdownH6 = ({ className, children, ...props }: ComponentProps<"h6">) => (
  <h6
    className={cn(
      "text-sm font-medium text-neutral-400 mb-1.5 mt-2 first:mt-0",
      "font-sans tracking-tight uppercase",
      className
    )}
    {...props}
  >
    {children}
  </h6>
)

export const MarkdownUL = ({ className, children, ...props }: ComponentProps<"ul">) => (
  <ul
    className={cn(
      "space-y-2 mb-4 pl-6 list-disc",
      "text-neutral-200",
      "marker:text-neutral-500",
      className
    )}
    {...props}
  >
    {children}
  </ul>
)

export const MarkdownOL = ({ className, children, ...props }: ComponentProps<"ol">) => (
  <ol
    className={cn(
      "space-y-2 mb-4 pl-6 list-decimal",
      "text-neutral-200",
      "marker:text-neutral-500 marker:font-medium",
      className
    )}
    {...props}
  >
    {children}
  </ol>
)

export const MarkdownLI = ({ className, children, ...props }: ComponentProps<"li">) => (
  <li
    className={cn(
      "leading-relaxed text-neutral-200",
      "marker:text-neutral-500",
      className
    )}
    {...props}
  >
    {children}
  </li>
)

export const MarkdownP = ({ className, children, ...props }: ComponentProps<"p">) => (
  <p className={cn("leading-relaxed mb-4 last:mb-0", className)} {...props}>
    {children}
  </p>
)

export const MarkdownCode = ({
  className,
  children,
  ...props
}: ComponentProps<"code">) => (
  <code
    className={cn(
      "bg-neutral-800 text-neutral-200 px-1.5 py-0.5 rounded text-sm",
      "border border-neutral-700",
      "font-mono",
      className
    )}
    {...props}
  >
    {children}
  </code>
)

export const MarkdownPre = ({ className, children, ...props }: ComponentProps<"pre">) => (
  <pre
    className={cn(
      "bg-neutral-900 text-neutral-200 p-4 rounded-lg mb-4 overflow-x-auto",
      "border border-neutral-700",
      "font-mono text-sm leading-relaxed",
      className
    )}
    {...props}
  >
    {children}
  </pre>
)

export const MarkdownBlockquote = ({
  className,
  children,
  ...props
}: ComponentProps<"blockquote">) => (
  <blockquote
    className={cn(
      "border-l-4 border-neutral-600 pl-4 py-2 mb-4",
      "text-neutral-300 italic",
      "bg-neutral-900/50 rounded-r-lg",
      className
    )}
    {...props}
  >
    {children}
  </blockquote>
)

export const MarkdownStrong = ({
  className,
  children,
  ...props
}: ComponentProps<"strong">) => (
  <strong className={cn("font-medium text-white", className)} {...props}>
    {children}
  </strong>
)

export const MarkdownEm = ({ className, children, ...props }: ComponentProps<"em">) => (
  <em className={cn("italic text-neutral-200", className)} {...props}>
    {children}
  </em>
)

export const MarkdownA = ({ className, children, ...props }: ComponentProps<"a">) => (
  <a
    className={cn(
      "text-blue-400 hover:text-blue-300 underline underline-offset-2",
      "transition-colors duration-200",
      className
    )}
    {...props}
  >
    {children}
  </a>
)

export const MarkdownHR = ({ className, ...props }: ComponentProps<"hr">) => (
  <hr className={cn("border-0 h-px bg-neutral-700 my-6", className)} {...props} />
)
