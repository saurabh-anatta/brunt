import { Component } from '@theme/component';

/**
 * @typedef {Object} CustomNavDrawerRefs
 * @property {HTMLElement} overlay - Background overlay element
 * @property {HTMLElement} drawerPanel - Main drawer container
 * @property {HTMLElement} filterPanel - Right-side filter panel
 * @property {HTMLButtonElement[]} tabButtons - Array of tab button elements
 * @property {HTMLElement[]} tabPanels - Array of tab content panels
 * @property {HTMLElement[]} filterContents - Array of filter content panels
 */

/** @extends {Component<CustomNavDrawerRefs>} */
class CustomNavDrawer extends Component {
  /** @type {string|null} */
  #activeTab = null;

  /** @type {string|null} */
  #activeFilter = null;

  /** @type {number|null} */
  #closeTimer = null;

  /** @type {number|null} */
  #openTimer = null;

  /** @type {Set<string>} */
  #tabTitles = new Set();

  /** @type {AbortController|null} */
  #externalAbort = null;

  /** @type {AbortSignal|null} */
  #hookSignal = null;

  /** @type {MutationObserver|null} */
  #headerObserver = null;

  connectedCallback() {
    super.connectedCallback();

    this.#externalAbort = new AbortController();
    const signal = this.#externalAbort.signal;

    /* Collect configured tab titles */
    if (this.refs.tabButtons) {
      for (const btn of this.refs.tabButtons) {
        const title = btn.dataset.tabTitle;
        if (title) {
          this.#tabTitles.add(title.trim().toLowerCase());
        }
      }
    }

    /* Hook into header menu items */
    this.#hookHeaderMenuItems(signal);

    /* Hook into mobile hamburger */
    this.#hookMobileDrawer(signal);

    /* Global keyboard listener */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeDrawer();
      }
    }, { signal });

    /* Pointer leave on drawer — start close timer */
    this.addEventListener('pointerleave', () => {
      this.#startCloseTimer();
    }, { signal });

    this.addEventListener('pointerenter', () => {
      this.#cancelCloseTimer();
    }, { signal });

    /* Internal event delegation */
    this.addEventListener('click', (e) => {
      this.#handleClick(e);
    }, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.body.classList.remove('custom-nav-drawer-active');
    document.body.style.removeProperty('overflow');
    if (this.#externalAbort) {
      this.#externalAbort.abort();
      this.#externalAbort = null;
    }
    if (this.#headerObserver) {
      this.#headerObserver.disconnect();
      this.#headerObserver = null;
    }
    this.#cancelCloseTimer();
    this.#cancelOpenTimer();
  }

  /**
   * Hook into the native Horizon header menu. The desktop menu (`<header-menu>`)
   * hydrates asynchronously and its overflow-list re-renders items, so binding
   * once on connect frequently misses every link. We bind immediately, then keep
   * re-binding (idempotently) whenever the header DOM changes.
   * @param {AbortSignal} signal
   */
  #hookHeaderMenuItems(signal) {
    this.#hookSignal = signal;

    /* Bind whatever is already in the DOM */
    this.#bindHeaderMenuItems();

    /* Re-bind as the header menu hydrates / reflows */
    const headerRoot = document.getElementById('header-group') || document.body;
    this.#headerObserver = new MutationObserver(() => this.#bindHeaderMenuItems());
    this.#headerObserver.observe(headerRoot, { childList: true, subtree: true });
  }

  #bindHeaderMenuItems() {
    const signal = this.#hookSignal;
    if (!signal) return;

    const menuLinks = document.querySelectorAll('.menu-list__link-title');

    for (const linkEl of menuLinks) {
      const text = linkEl.textContent.trim().toLowerCase();

      if (!this.#tabTitles.has(text)) continue;

      const listItem = linkEl.closest('.menu-list__list-item');
      const anchor = linkEl.closest('a, button');
      const target = listItem || anchor;

      /* Skip items already wired up */
      if (!target || target.dataset.cndHooked === 'true') continue;
      target.dataset.cndHooked = 'true';

      const tabTitle = linkEl.textContent.trim();

      if (listItem) {
        listItem.addEventListener('pointerenter', () => {
          this.#cancelCloseTimer();
          this.#startOpenTimer(tabTitle);
        }, { signal });

        listItem.addEventListener('pointerleave', () => {
          this.#cancelOpenTimer();
          this.#startCloseTimer();
        }, { signal });
      }

      if (anchor) {
        anchor.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.#cancelOpenTimer();
          this.openDrawer(tabTitle);
        }, { signal });
      }
    }
  }

  /**
   * @param {AbortSignal} signal
   */
  #hookMobileDrawer(signal) {
    const headerDrawer = document.querySelector('header-drawer');
    if (!headerDrawer) return;

    const summary = headerDrawer.querySelector('summary');
    if (!summary) return;

    summary.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      /* Close the native drawer if it's open */
      const details = summary.closest('details');
      if (details && details.open) {
        details.open = false;
      }

      /* Open our custom drawer with the first tab */
      const firstTab = this.refs.tabButtons?.[0];
      if (firstTab) {
        this.openDrawer(firstTab.dataset.tabTitle);
      }
    }, { signal });
  }

  /**
   * @param {string} tabTitle
   */
  openDrawer(tabTitle) {
    this.classList.add('custom-nav-drawer--open');
    document.body.classList.add('custom-nav-drawer-active');
    document.body.style.overflow = 'hidden';

    this.switchTab(tabTitle);
    this.#cancelCloseTimer();

    this.dispatchEvent(new CustomEvent('custom-nav-drawer:open', {
      detail: { tabTitle },
      bubbles: true,
    }));
  }

  closeDrawer() {
    this.classList.remove('custom-nav-drawer--open');
    this.classList.remove('custom-nav-drawer--filter-open');
    document.body.classList.remove('custom-nav-drawer-active');
    document.body.style.removeProperty('overflow');

    /* Close filter panel */
    this.#closeFilterPanel();

    this.#activeTab = null;
    this.#cancelCloseTimer();
    this.#cancelOpenTimer();

    this.dispatchEvent(new CustomEvent('custom-nav-drawer:close', { bubbles: true }));
  }

  /**
   * @param {string} tabTitle
   */
  switchTab(tabTitle) {
    this.#activeTab = tabTitle;

    /* Update tab buttons */
    if (this.refs.tabButtons) {
      for (const btn of this.refs.tabButtons) {
        const isActive = btn.dataset.tabTitle.trim().toLowerCase() === tabTitle.trim().toLowerCase();
        btn.classList.toggle('custom-nav-drawer__tab--active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
      }
    }

    /* Show matching panel */
    if (this.refs.tabPanels) {
      for (const panel of this.refs.tabPanels) {
        const isActive = panel.dataset.tabTitle.trim().toLowerCase() === tabTitle.trim().toLowerCase();
        panel.classList.toggle('custom-nav-drawer__tab-panel--active', isActive);
      }
    }

    /* Close any open filter panel */
    this.#closeFilterPanel();
  }

  /**
   * @param {string} parentHandle
   */
  openFilterPanel(parentHandle) {
    this.#activeFilter = parentHandle;

    /* Show filter panel container */
    const filterPanel = this.refs.filterPanel;
    if (filterPanel) {
      filterPanel.classList.add('custom-nav-drawer__filter-panel--open');
    }

    /* Show matching filter content */
    if (this.refs.filterContents) {
      for (const content of this.refs.filterContents) {
        const isActive = content.dataset.parentHandle === parentHandle;
        content.classList.toggle('custom-nav-drawer__filter-content--active', isActive);
      }
    }

    /* Expand drawer width */
    this.classList.add('custom-nav-drawer--filter-open');
  }

  #closeFilterPanel() {
    this.#activeFilter = null;

    const filterPanel = this.refs.filterPanel;
    if (filterPanel) {
      filterPanel.classList.remove('custom-nav-drawer__filter-panel--open');
    }

    if (this.refs.filterContents) {
      for (const content of this.refs.filterContents) {
        content.classList.remove('custom-nav-drawer__filter-content--active');
      }
    }

    this.classList.remove('custom-nav-drawer--filter-open');
  }

  /**
   * @param {HTMLElement} accordionEl
   */
  toggleAccordion(accordionEl) {
    const isOpen = accordionEl.classList.toggle('custom-nav-accordion--open');
    const header = accordionEl.querySelector('.custom-nav-accordion__header');
    if (header) {
      header.setAttribute('aria-expanded', String(isOpen));
    }
  }

  /**
   * @param {Event} e
   */
  #handleClick(e) {
    const target = /** @type {HTMLElement} */ (e.target);

    /* Close button */
    if (target.closest('[data-action="close"]')) {
      e.preventDefault();
      this.closeDrawer();
      return;
    }

    /* Tab button */
    const tabBtn = target.closest('[data-action="switch-tab"]');
    if (tabBtn) {
      e.preventDefault();
      this.switchTab(tabBtn.dataset.tabTitle);
      return;
    }

    /* Menu item with submenu */
    const submenuItem = target.closest('[data-has-submenu]');
    if (submenuItem) {
      e.preventDefault();
      this.openFilterPanel(submenuItem.dataset.parentHandle);
      return;
    }

    /* Filter panel back button (mobile) */
    const backBtn = target.closest('[data-action="close-filter"]');
    if (backBtn) {
      e.preventDefault();
      this.#closeFilterPanel();
      return;
    }

    /* Accordion header */
    const accordionHeader = target.closest('.custom-nav-accordion__header');
    if (accordionHeader) {
      e.preventDefault();
      const accordion = accordionHeader.closest('.custom-nav-accordion');
      if (accordion) {
        this.toggleAccordion(accordion);
      }
      return;
    }

    /* Overlay click */
    if (target.classList.contains('custom-nav-drawer__overlay')) {
      this.closeDrawer();
      return;
    }
  }

  #startCloseTimer() {
    this.#cancelCloseTimer();
    this.#closeTimer = window.setTimeout(() => {
      this.closeDrawer();
    }, 300);
  }

  #cancelCloseTimer() {
    if (this.#closeTimer !== null) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }

  /**
   * @param {string} tabTitle
   */
  #startOpenTimer(tabTitle) {
    this.#cancelOpenTimer();
    this.#openTimer = window.setTimeout(() => {
      this.openDrawer(tabTitle);
    }, 150);
  }

  #cancelOpenTimer() {
    if (this.#openTimer !== null) {
      clearTimeout(this.#openTimer);
      this.#openTimer = null;
    }
  }
}

customElements.define('custom-nav-drawer', CustomNavDrawer);
