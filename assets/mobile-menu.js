(() => {
  const LOCALE_PREF_KEY = "fat:site-locale-pref:v1";
  const ARABIC_PAGE_MAP = {
    "/": "/ar/",
    "/audio-video-transcription-online.html": "/ar/audio-video-transcription-online.html"
  };

  function normalizePath(pathname) {
    const value = String(pathname || "/").trim();

    if (!value || value === "/") {
      return "/";
    }

    if (/^\/index\.html$/i.test(value)) {
      return "/";
    }

    if (/^\/ar\/index\.html$/i.test(value)) {
      return "/ar/";
    }

    return value.replace(/\/{2,}/g, "/");
  }

  function getStoredLocalePreference() {
    try {
      const value = window.localStorage.getItem(LOCALE_PREF_KEY);
      return value === "ar" || value === "en" ? value : "";
    } catch (error) {
      return "";
    }
  }

  function setStoredLocalePreference(locale) {
    try {
      window.localStorage.setItem(LOCALE_PREF_KEY, locale);
    } catch (error) {
      // Ignore storage failures
    }
  }

  function inferLocalePreference() {
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];

    return languages.some((value) => String(value || "").toLowerCase().startsWith("ar"))
      ? "ar"
      : "en";
  }

  function getEffectiveLocalePreference() {
    return getStoredLocalePreference() || inferLocalePreference();
  }

  function isArabicPage(pathname) {
    return normalizePath(pathname).startsWith("/ar/");
  }

  function getArabicVariant(pathname) {
    return ARABIC_PAGE_MAP[normalizePath(pathname)] || "";
  }

  function getEnglishVariant(pathname) {
    const normalized = normalizePath(pathname);
    const match = Object.entries(ARABIC_PAGE_MAP).find(([, arabicPath]) => arabicPath === normalized);
    return match ? match[0] : "";
  }

  function navigateTo(path) {
    if (!path) {
      return;
    }

    const nextUrl = new URL(path, window.location.origin);
    nextUrl.hash = window.location.hash || "";

    if (nextUrl.pathname + nextUrl.search + nextUrl.hash !== window.location.pathname + window.location.search + window.location.hash) {
      window.location.replace(nextUrl.toString());
    }
  }

  function isLocalPreviewHost(hostname) {
    const value = String(hostname || "").toLowerCase();
    return value === "localhost"
      || value === "0.0.0.0"
      || value === "::1"
      || value.startsWith("127.")
      || value.endsWith(".local");
  }

  function getGoogleTranslateSourceUrl() {
    const currentUrl = new URL(window.location.href);

    if (!isLocalPreviewHost(currentUrl.hostname)) {
      return currentUrl.toString();
    }

    const liveUrl = new URL(currentUrl.pathname + currentUrl.search + currentUrl.hash, "https://freeaudiotrim.com");
    return liveUrl.toString();
  }

  function openGoogleTranslateArabicPage() {
    const translateUrl = new URL("https://translate.google.com/translate");
    translateUrl.searchParams.set("sl", "en");
    translateUrl.searchParams.set("tl", "ar");
    translateUrl.searchParams.set("u", getGoogleTranslateSourceUrl());
    window.open(translateUrl.toString(), "_blank", "noopener,noreferrer");
  }

  function maybeRedirectByLocalePreference() {
    const normalizedPath = normalizePath(window.location.pathname);
    const preferredLocale = getEffectiveLocalePreference();
    const arabicVariant = getArabicVariant(normalizedPath);

    if (preferredLocale !== "ar" || isArabicPage(normalizedPath) || !arabicVariant) {
      return;
    }

    navigateTo(arabicVariant);
  }

  function closeMenuIfOpen() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".nav-links");

    if (!toggle || !nav) {
      return;
    }

    nav.classList.remove("open");
    toggle.classList.remove("is-active");
    toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
  }

  function createHelperButton(label, onClick, kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = kind ? "locale-helper__action locale-helper__action--" + kind : "locale-helper__action";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function removeLocaleHelperBar() {
    const existing = document.querySelector(".locale-helper");
    if (existing) {
      existing.remove();
    }
  }

  function injectLocaleHelperBar() {
    const normalizedPath = normalizePath(window.location.pathname);
    const preferredLocale = getEffectiveLocalePreference();
    const header = document.querySelector("header");
    const main = document.querySelector("main");
    const hasArabicVariant = !!getArabicVariant(normalizedPath);

    removeLocaleHelperBar();

    if (!header || isArabicPage(normalizedPath) || preferredLocale !== "ar") {
      return;
    }

    const bar = document.createElement("section");
    const body = document.createElement("div");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const text = document.createElement("p");
    const actions = document.createElement("div");

    bar.className = "locale-helper";
    bar.setAttribute("lang", "ar");
    bar.setAttribute("dir", "rtl");
    body.className = "locale-helper__body";
    copy.className = "locale-helper__copy";
    title.className = "locale-helper__title";
    text.className = "locale-helper__text";
    actions.className = "locale-helper__actions";

    title.textContent = hasArabicVariant
      ? "تفضيل العربية مفعّل."
      : "تفضيل اللغة العربية مفعّل.";

    text.textContent = hasArabicVariant
      ? "هذه الصفحة لها نسخة عربية. سنحوّلك إليها تلقائيًا عند فتح الصفحة بالإنجليزية."
      : "هذه الصفحة متاحة بالإنجليزية حاليًا. سنحوّلك تلقائيًا إلى الصفحات العربية عندما تكون متوفرة، ويمكنك استخدام ترجمة تلقائية لهذه الصفحة أو متابعة التصفح من الصفحة العربية الرئيسية.";

    copy.appendChild(title);
    copy.appendChild(text);

    if (!hasArabicVariant) {
      actions.appendChild(createHelperButton("الصفحة العربية الرئيسية", () => {
        setStoredLocalePreference("ar");
        navigateTo("/ar/");
      }, "primary"));

      actions.appendChild(createHelperButton("ترجمة هذه الصفحة", () => {
        setStoredLocalePreference("ar");
        openGoogleTranslateArabicPage();
      }, "secondary"));

      actions.appendChild(createHelperButton("أداة تحويل الصوت إلى نص", () => {
        setStoredLocalePreference("ar");
        navigateTo("/ar/audio-video-transcription-online.html");
      }));
    }

    actions.appendChild(createHelperButton("استخدام الإنجليزية", () => {
      setStoredLocalePreference("en");
      removeLocaleHelperBar();
      ensureLocaleToggle();
      closeMenuIfOpen();
    }));

    body.appendChild(copy);
    body.appendChild(actions);
    bar.appendChild(body);

    if (main && header.nextSibling) {
      header.parentNode.insertBefore(bar, main);
    } else if (main && main.parentNode) {
      main.parentNode.insertBefore(bar, main);
    } else {
      header.insertAdjacentElement("afterend", bar);
    }
  }

  function ensureLocaleToggle() {
    const nav = document.querySelector(".nav-links");
    const normalizedPath = normalizePath(window.location.pathname);

    if (!nav) {
      return;
    }

    let toggleLink = nav.querySelector("[data-locale-toggle]");
    const arabicPage = isArabicPage(normalizedPath);
    const englishTarget = arabicPage ? (getEnglishVariant(normalizedPath) || "/") : normalizedPath;
    const arabicTarget = arabicPage ? normalizedPath : getArabicVariant(normalizedPath);

    if (!toggleLink) {
      toggleLink = nav.querySelector('a[lang="ar"], a[lang="en"]');
      if (!toggleLink) {
        toggleLink = document.createElement("a");
        nav.appendChild(toggleLink);
      }
      toggleLink.setAttribute("data-locale-toggle", "true");
    }

    toggleLink.removeAttribute("dir");
    toggleLink.removeAttribute("lang");

    if (arabicPage) {
      toggleLink.textContent = "English";
      toggleLink.href = englishTarget || "/";
      toggleLink.lang = "en";
      toggleLink.dir = "ltr";
      toggleLink.onclick = function () {
        setStoredLocalePreference("en");
      };
      return;
    }

    toggleLink.textContent = "العربية";
    toggleLink.lang = "ar";
    toggleLink.dir = "rtl";
    toggleLink.href = arabicTarget || normalizedPath;
    toggleLink.onclick = function (event) {
      setStoredLocalePreference("ar");

      if (arabicTarget) {
        return;
      }

      event.preventDefault();
      injectLocaleHelperBar();
      closeMenuIfOpen();
    };
  }

  function initLocalePreference() {
    maybeRedirectByLocalePreference();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        ensureLocaleToggle();
        injectLocaleHelperBar();
      }, { once: true });
      return;
    }

    ensureLocaleToggle();
    injectLocaleHelperBar();
  }

  function initMobileMenu() {
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
  }

  initLocalePreference();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileMenu, { once: true });
  } else {
    initMobileMenu();
  }
})();
