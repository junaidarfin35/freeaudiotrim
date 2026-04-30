(() => {
  const initMobileMenu = () => {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".nav-links");

    if (!toggle || !nav) return;

    if (!toggle.querySelector(".menu-toggle__icon")) {
      toggle.innerHTML = [
        '<span class="menu-toggle__icon" aria-hidden="true">',
        "<span></span>",
        "<span></span>",
        "<span></span>",
        "</span>"
      ].join("");
    }

    const originalParent = nav.parentNode;
    const navAnchor = document.createComment("mobile-nav-anchor");
    let navPortaled = false;

    const ensureNavPlacement = () => {
      if (window.innerWidth <= 768) {
        if (!navPortaled && originalParent) {
          originalParent.insertBefore(navAnchor, nav);
          document.body.appendChild(nav);
          navPortaled = true;
        }
      } else if (navPortaled && navAnchor.parentNode) {
        navAnchor.parentNode.replaceChild(nav, navAnchor);
        navPortaled = false;
      }
    };

    const setMenuOpen = (open) => {
      nav.classList.toggle("open", open);
      toggle.classList.toggle("is-active", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.classList.toggle("menu-open", open);
    };

    ensureNavPlacement();
    setMenuOpen(false);

    toggle.addEventListener("click", () => {
      ensureNavPlacement();
      setMenuOpen(!nav.classList.contains("open"));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setMenuOpen(false));
    });

    document.addEventListener("click", (event) => {
      if (window.innerWidth > 768 || !nav.classList.contains("open")) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      setMenuOpen(false);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) setMenuOpen(false);
      ensureNavPlacement();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileMenu, { once: true });
  } else {
    initMobileMenu();
  }
})();
