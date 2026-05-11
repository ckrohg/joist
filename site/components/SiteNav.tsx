import Link from "next/link";

const links = [
  { href: "/spec", label: "Spec" },
  { href: "/install", label: "Install" },
  { href: "/why", label: "Why" },
];

export function SiteNav() {
  return (
    <nav className="site-nav">
      <div className="container-x nav-inner">
        <Link href="/" className="logo" aria-label="Joist home">
          Joist
        </Link>
        <div className="nav-links">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
          <a
            href="https://github.com/ckrohg/tenet-elementor"
            className="nav-cta"
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub →
          </a>
        </div>
      </div>
    </nav>
  );
}
