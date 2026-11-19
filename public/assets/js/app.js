
'use strict';

import {
  watchAuthentication,
  showLogin,
  logoutAdmin
} from './login.js';

import {
  initializeRouter,
  destroyRouter,
  navigateTo
} from './pages/index.js';

import {
  createElement,
  showToast
} from './helpers.js';

// ========================================
// Application Configuration
// ========================================

const APP_CONFIG = {
  stylesheet: '/assets/css/admin.css',
  defaultPage: 'dashboard',


  cloudinary: {
    cloudName: 'mqn4vzh2',
    uploadPreset: 'product',
    folder: 'product'
  }
};

window.APP_CONFIG = APP_CONFIG;



const PAGE_TITLES = {
  dashboard: 'Dashboard',
  products: 'Products',
  orders: 'Orders',
  pos: 'POS',
  reports: 'Reports',
  botChats: 'Bot Chats',
  facebook: 'Facebook',
  lots: 'Purchase Lots',
  coupons: 'Coupons',
  collections: 'Collections',
  categories: 'Categories',
  subcategories: 'Subcategories',
  settings: 'Settings'
};

// ========================================
// Application State
// ========================================

const app = document.getElementById('app');

let currentAdmin = null;
let stopAuthObserver = null;

let appInitialized = false;

let authRevision = 0;
let authQueue = Promise.resolve();

let outsideClickHandler = null;

// ========================================
// Load CSS
// ========================================

function loadAdminStylesheet() {
  const existing = document.getElementById(
    'admin-stylesheet'
  );

  if (existing) {
    return;
  }

  const stylesheet = createElement('link', {
    attributes: {
      id: 'admin-stylesheet',
      rel: 'stylesheet',
      href: APP_CONFIG.stylesheet
    }
  });

  document.head.appendChild(stylesheet);
}

// ========================================
// Application Error
// ========================================

function renderFatalError(message) {
  if (!app) {
    return;
  }

  const wrapper = createElement('main', {
    className: 'fatal-error'
  });

  const title = createElement('h1', {
    text: 'Application Error'
  });

  const description = createElement('p', {
    text: message
  });

  const reloadButton = createElement('button', {
    className: 'btn btn-primary',
    text: 'Reload Application',
    attributes: {
      type: 'button'
    }
  });

  reloadButton.addEventListener('click', () => {
    window.location.reload();
  });

  wrapper.append(
    title,
    description,
    reloadButton
  );

  app.replaceChildren(wrapper);
}

// ========================================
// Header Page Title
// ========================================

function updateHeaderTitle(pageName) {
  const heading = document.getElementById(
    'header-page-title'
  );

  if (!heading) {
    return;
  }

  heading.textContent =
    PAGE_TITLES[pageName] || 'Dashboard';
}

// ========================================
// Sidebar State
// ========================================

function closeSidebar(menuButton) {
  document.body.classList.remove('sidebar-open');

  if (menuButton) {
    menuButton.setAttribute(
      'aria-expanded',
      'false'
    );
  }
}

// ========================================
// Admin Layout
// ========================================

function renderAdminLayout(admin) {
  currentAdmin = admin;

  // Remove previous outside click listener.
  if (outsideClickHandler) {
    document.removeEventListener(
      'click',
      outsideClickHandler
    );

    outsideClickHandler = null;
  }

  closeSidebar();

  const layout = createElement('div', {
    className: 'admin-layout'
  });

  // ======================================
  // Sidebar
  // ======================================

  const sidebar = createElement('aside', {
    className: 'admin-sidebar',
    attributes: {
      id: 'admin-sidebar'
    }
  });

  // ======================================
  // Brand
  // ======================================

  const brand = createElement('div', {
    className: 'sidebar-brand'
  });

  const brandLogo = createElement('div', {
    className: 'sidebar-logo',
    text: 'NF'
  });

  const brandName = createElement('span', {
    text: 'Category Admin'
  });

  brand.append(
    brandLogo,
    brandName
  );

  // ======================================
  // Navigation
  // ======================================

  const navigation = createElement('nav', {
    className: 'sidebar-navigation',
    attributes: {
      'aria-label': 'Main navigation'
    }
  });

  // ======================================
  // Dashboard Link
  // ======================================

  const dashboardLink = createElement('a', {
    className: 'sidebar-link',
    text: '⌂ Dashboard',
    attributes: {
      href: '#dashboard'
    },
    dataset: {
      page: 'dashboard'
    }
  });

  const ordersLink = createElement('a', {
    className: 'sidebar-link',
    text: '☷ Orders',
    attributes: {
      href: '#orders'
    },
    dataset: {
      page: 'orders'
    }
  });

  const posLink = createElement('a', {
    className: 'sidebar-link',
    text: '▣ POS',
    attributes: {
      href: '#pos'
    },
    dataset: {
      page: 'pos'
    }
  });

  const botChatsLink = createElement('a', {
    className: 'sidebar-link',
    text: '◌ Bot Chats',
    attributes: {
      href: '#botChats'
    },
    dataset: {
      page: 'botChats'
    }
  });

  const facebookLink = createElement('a', {
    className: 'sidebar-link',
    text: '◉ Facebook',
    attributes: {
      href: '#facebook'
    },
    dataset: {
      page: 'facebook'
    }
  });

  const reportsLink = createElement('a', {
    className: 'sidebar-link',
    text: '▤ Reports',
    attributes: {
      href: '#reports'
    },
    dataset: {
      page: 'reports'
    }
  });

  // ======================================
  // Products Link
  // ======================================

  const productsLink = createElement('a', {
    className: 'sidebar-link',
    text: '▣ Products',
    attributes: {
      href: '#products'
    },
    dataset: {
      page: 'products'
    }
  });



  // ======================================
  // Purchase Lots Link
  // ======================================

  const lotsLink = createElement('a', {
    className: 'sidebar-link',
    text: '▤ Purchase Lots',
    attributes: {
      href: '#lots'
    },
    dataset: {
      page: 'lots'
    }
  });

  const couponsLink = createElement('a', {
    className: 'sidebar-link',
    text: '◇ Coupons',
    attributes: {
      href: '#coupons'
    },
    dataset: {
      page: 'coupons'
    }
  });
  // ======================================
  // Collections Group
  // ======================================

  const collectionsGroup = createElement('div', {
    className: 'sidebar-group'
  });

  // Collections Header
  const collectionsHeader = createElement('div', {
    className: 'sidebar-group-header'
  });

  // Collections Page Link
  const collectionsLink = createElement('a', {
    className: 'sidebar-link sidebar-group-link',
    text: '▦ Collections',
    attributes: {
      href: '#collections'
    },
    dataset: {
      page: 'collections'
    }
  });

  // Submenu Toggle Button
  const submenuToggle = createElement('button', {
    className: 'sidebar-group-toggle',
    text: '⌄',
    attributes: {
      type: 'button',
      'aria-label': 'Toggle Collections submenu',
      'aria-expanded': 'false',
      'aria-controls': 'collections-submenu'
    }
  });

  collectionsHeader.append(
    collectionsLink,
    submenuToggle
  );

  // ======================================
  // Collections Submenu
  // ======================================

  const submenu = createElement('div', {
    className: 'sidebar-submenu',
    attributes: {
      id: 'collections-submenu',
      hidden: true
    }
  });

  const categoriesLink = createElement('a', {
    className: 'sidebar-sublink',
    text: '▤ Categories',
    attributes: {
      href: '#categories'
    },
    dataset: {
      page: 'categories'
    }
  });

  const subcategoriesLink = createElement('a', {
    className: 'sidebar-sublink',
    text: '☷ Subcategories',
    attributes: {
      href: '#subcategories'
    },
    dataset: {
      page: 'subcategories'
    }
  });

  submenu.append(
    categoriesLink,
    subcategoriesLink
  );

  collectionsGroup.append(
    collectionsHeader,
    submenu
  );

  const settingsLink = createElement('a', {
    className: 'sidebar-link',
    text: '⚙ Settings',
    attributes: {
      href: '#settings'
    },
    dataset: {
      page: 'settings'
    }
  });

  // ======================================
  // Add Navigation Items
  // ======================================

  navigation.append(
    dashboardLink,
    posLink,
    productsLink,
    ordersLink,
    botChatsLink,
    facebookLink,
    reportsLink,
    lotsLink,
    couponsLink,
    collectionsGroup,
    settingsLink
  );

  sidebar.append(
    brand,
    navigation
  );

  // ======================================
  // Main Area
  // ======================================

  const main = createElement('div', {
    className: 'admin-main'
  });

  // ======================================
  // Header
  // ======================================

  const header = createElement('header', {
    className: 'admin-header'
  });

  const headerLeft = createElement('div', {
    className: 'header-left'
  });

  const menuButton = createElement('button', {
    className: 'sidebar-toggle',
    text: '☰',
    attributes: {
      type: 'button',
      'aria-label': 'Toggle navigation',
      'aria-controls': 'admin-sidebar',
      'aria-expanded': 'false'
    }
  });

  const pageHeading = createElement('h1', {
    className: 'header-title',
    text: 'Dashboard',
    attributes: {
      id: 'header-page-title'
    }
  });

  headerLeft.append(
    menuButton,
    pageHeading
  );

  const headerRight = createElement('div', {
    className: 'header-right'
  });

  const adminInfo = createElement('div', {
    className: 'admin-info'
  });

  const adminEmail = createElement('span', {
    className: 'admin-email',
    text: admin?.email || 'Administrator'
  });

  const logoutButton = createElement('button', {
    className: 'btn btn-outline logout-button',
    text: 'Logout',
    attributes: {
      type: 'button'
    }
  });

  adminInfo.append(
    adminEmail,
    logoutButton
  );

  headerRight.append(adminInfo);

  header.append(
    headerLeft,
    headerRight
  );

  // ======================================
  // Page Container
  // ======================================

  const pageContent = createElement('main', {
    className: 'page-content',
    attributes: {
      id: 'page-content'
    }
  });

  main.append(
    header,
    pageContent
  );

  layout.append(
    sidebar,
    main
  );

  app.replaceChildren(layout);

  // ======================================
  // Collections Submenu Toggle
  // ======================================

  function setCollectionsExpanded(expanded) {
    submenu.hidden = !expanded;

    submenuToggle.setAttribute(
      'aria-expanded',
      String(expanded)
    );

    submenuToggle.textContent = expanded
      ? '⌃'
      : '⌄';

    collectionsGroup.classList.toggle(
      'submenu-open',
      expanded
    );
  }

  submenuToggle.addEventListener('click', () => {
    const isExpanded =
      submenuToggle.getAttribute('aria-expanded') === 'true';

    setCollectionsExpanded(!isExpanded);
  });

  // ======================================
  // Sidebar Toggle
  // ======================================

  menuButton.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle(
      'sidebar-open'
    );

    menuButton.setAttribute(
      'aria-expanded',
      String(isOpen)
    );
  });

  // ======================================
  // Outside Click
  // ======================================

  outsideClickHandler = event => {
    if (!document.body.classList.contains('sidebar-open')) {
      return;
    }

    const target = event.target;

    const clickedInsideSidebar = sidebar.contains(target);
    const clickedMenuButton = menuButton.contains(target);

    if (!clickedInsideSidebar && !clickedMenuButton) {
      closeSidebar(menuButton);
    }
  };

  document.addEventListener(
    'click',
    outsideClickHandler
  );

  // ======================================
  // Navigation Events
  // ======================================

  navigation.addEventListener('click', event => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest('[data-page]');

    if (!link || !navigation.contains(link)) {
      return;
    }

    const pageName = link.dataset.page;

    updateHeaderTitle(pageName);

    // Keep Categories and Subcategories visible.
    if (
      pageName === 'categories' ||
      pageName === 'subcategories'
    ) {
      setCollectionsExpanded(true);
    }

    closeSidebar(menuButton);
  });

  // ======================================
  // Logout
  // ======================================

  logoutButton.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Are you sure you want to logout?'
    );

    if (!confirmed) {
      return;
    }

    logoutButton.disabled = true;
    logoutButton.textContent = 'Logging out...';

    try {
      await logoutAdmin();

    } catch (error) {
      console.error(
        '[APP LOGOUT ERROR]',
        error
      );

      showToast(
        'Logout failed. Please try again.',
        'error'
      );

    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = 'Logout';
    }
  });

  return layout;
}

// ========================================
// Login Screen
// ========================================

async function renderLoginScreen() {
  currentAdmin = null;

  closeSidebar();

  if (outsideClickHandler) {
    document.removeEventListener(
      'click',
      outsideClickHandler
    );

    outsideClickHandler = null;
  }

  await showLogin(app);
}

// ========================================
// Authentication State Handler
// ========================================

async function handleAuthentication(state, revision) {
  try {
    // Unauthenticated
    if (!state?.authenticated || !state?.user) {
      await destroyRouter();

      if (revision !== authRevision) {
        return;
      }

      currentAdmin = null;

      await renderLoginScreen();

      return;
    }

    // Authenticated Admin
    const admin = {
      ...state.admin,
      uid: state.admin?.uid || state.user.uid,
      email: state.admin?.email || state.user.email
    };

    if (
      currentAdmin?.uid === admin.uid &&
      document.querySelector('.admin-layout')
    ) {
      return;
    }

    if (revision !== authRevision) {
      return;
    }

    renderAdminLayout(admin);

    await initializeRouter({
      root: app,
      initialPage: APP_CONFIG.defaultPage
    });

    if (revision !== authRevision) {
      return;
    }

  } catch (error) {
    console.error(
      '[AUTH STATE ERROR]',
      error
    );

    if (revision === authRevision) {
      renderFatalError(
        'Unable to initialize the admin application.'
      );
    }
  }
}

// ========================================
// Queue Authentication Changes
// ========================================

function queueAuthentication(state) {
  const revision = ++authRevision;

  authQueue = authQueue
    .then(() => {
      if (revision !== authRevision) {
        return;
      }

      return handleAuthentication(
        state,
        revision
      );
    })
    .catch(error => {
      console.error(
        '[AUTH QUEUE ERROR]',
        error
      );
    });

  return authQueue;
}

// ========================================
// Application Initialization
// ========================================

function initializeApplication() {
  if (appInitialized) {
    return;
  }

  if (!app) {
    console.error(
      'Application root #app was not found.'
    );

    return;
  }

  appInitialized = true;

  loadAdminStylesheet();

  app.replaceChildren(
    createElement('div', {
      className: 'app-loading',
      text: 'Loading Nishat Fashion...'
    })
  );

  stopAuthObserver = watchAuthentication(
    queueAuthentication
  );
}

// ========================================
// Programmatic Navigation
// ========================================

export function navigateToPage(pageName, options = {}) {
  if (!PAGE_TITLES[pageName]) {
    console.warn(
      `[APP] Unknown page: ${pageName}`
    );

    return Promise.resolve(false);
  }

  updateHeaderTitle(pageName);

  closeSidebar(
    document.querySelector('.sidebar-toggle')
  );

  return navigateTo(
    pageName,
    options
  );
}

// ========================================
// Application Cleanup
// ========================================

window.addEventListener('beforeunload', () => {
  if (typeof stopAuthObserver === 'function') {
    stopAuthObserver();
  }

  if (outsideClickHandler) {
    document.removeEventListener(
      'click',
      outsideClickHandler
    );
  }
});

// ========================================
// Start Application
// ========================================

initializeApplication();
