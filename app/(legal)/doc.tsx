/** Shared prose styling for the legal documents (descendant selectors keep each
 *  page's content clean — just semantic HTML, no per-element classes). */
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className="
        [&_h2]:mt-9 [&_h2]:mb-0 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground
        [&_p]:mt-3 [&_p]:text-[14.5px] [&_p]:leading-[1.75] [&_p]:text-foreground/80
        [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-[14.5px] [&_ul]:text-foreground/80
        [&_li]:leading-[1.7]
        [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
        [&_strong]:font-semibold [&_strong]:text-foreground
      "
    >
      <h1 className="text-[30px] font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">Last updated: {updated}</p>
      <div className="mt-6">{children}</div>
    </article>
  );
}
