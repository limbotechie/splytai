"use client";

interface Section {
  id: string;
  title: string;
}

export function JumpToDropdown({ sections }: { sections: Section[] }) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const el = document.getElementById(e.target.value);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    e.target.value = "";
  };

  return (
    <select
      onChange={handleChange}
      defaultValue=""
      aria-label="Jump to section"
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground focus:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option value="" disabled>
        Jump to section…
      </option>
      {sections.map(({ id, title }) => (
        <option key={id} value={id}>
          {title}
        </option>
      ))}
    </select>
  );
}
