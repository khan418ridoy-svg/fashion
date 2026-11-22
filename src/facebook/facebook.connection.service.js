
'use strict';

const { db } = require('../config/firebase');

const {
  cleanString,
  FacebookError,
  isValidPageId
} = require('./facebook.utils');

const {
  encryptToken,
  decryptToken,
  isEncryptedToken
} = require('./facebook.crypto');

const {
  graphRequest
} = require('./facebook.graph');

const CONNECTION_COLLECTION = 'facebookConnections';
const CONNECTION_DOC = 'primary';
const PAGES_COLLECTION = 'facebookPages';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10000;
const WRITE_BATCH_SIZE = 400;

/**
 * Get the admin UID from the authenticated request.
 */
function normalizeAdminUid(adminUid) {
  const uid = cleanString(adminUid, 128);

  if (!uid) {
    throw new FacebookError(
      'Authenticated admin user is required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  return uid;
}

/**
 * Get the main Facebook connection reference.
 */
function connectionRef() {
  return db
    .collection(CONNECTION_COLLECTION)
    .doc(CONNECTION_DOC);
}

/**
 * Get a Facebook connection belonging to the admin.
 */
async function getAdminConnection(adminUid) {
  const uid = normalizeAdminUid(adminUid);

  const snapshot = await connectionRef().get();

  if (!snapshot.exists) {
    throw new FacebookError(
      'Facebook account is not connected. Please connect Facebook first.',
      404,
      'FACEBOOK_NOT_CONNECTED'
    );
  }

  const connection = snapshot.data() || {};

  if (
    connection.connected !== true ||
    connection.adminUid !== uid
  ) {
    throw new FacebookError(
      'Facebook connection does not belong to this admin.',
      403,
      'FACEBOOK_CONNECTION_ACCESS_DENIED'
    );
  }

  if (!isEncryptedToken(connection.userAccessTokenEncrypted)) {
    throw new FacebookError(
      'Facebook User Access Token is missing or invalid. Reconnect Facebook.',
      401,
      'FACEBOOK_USER_TOKEN_INVALID'
    );
  }

  if (
    connection.tokenExpiresAt &&
    typeof connection.tokenExpiresAt.toDate === 'function' &&
    connection.tokenExpiresAt.toDate().getTime() <= Date.now()
  ) {
    throw new FacebookError(
      'Facebook User Access Token has expired. Reconnect Facebook.',
      401,
      'FACEBOOK_USER_TOKEN_EXPIRED'
    );
  }

  return {
    uid,
    data: connection,
    userAccessToken: decryptToken(
      connection.userAccessTokenEncrypted
    )
  };
}

/**
 * Fetch all accessible Facebook Pages.
 *
 * Pagination is handled on the backend.
 * Page tokens are never returned to the frontend.
 */
async function fetchAccessiblePages(userAccessToken) {
  const pages = [];
  let after = null;

  while (pages.length < MAX_PAGES) {
    const params = {
      fields: 'id,name,category,access_token,tasks',
      limit: PAGE_LIMIT
    };

    if (after) {
      params.after = after;
    }

    const response = await graphRequest('me/accounts', {
      method: 'GET',
      token: userAccessToken,
      params
    });

    const data = Array.isArray(response.data)
      ? response.data
      : [];

    for (const page of data) {
      const pageId = cleanString(page.id, 50);
      const pageName = cleanString(page.name, 200);
      const pageAccessToken = cleanString(
        page.access_token,
        10000
      );

      if (
        !isValidPageId(pageId) ||
        !pageName ||
        !pageAccessToken
      ) {
        continue;
      }

      pages.push({
        pageId,
        pageName,
        category: cleanString(page.category, 200),
        tasks: Array.isArray(page.tasks)
          ? page.tasks
              .map(task => cleanString(task, 100))
              .filter(Boolean)
          : [],
        pageAccessToken
      });

      if (pages.length >= MAX_PAGES) {
        break;
      }
    }

    after = cleanString(
      response.paging?.cursors?.after,
      500
    );

    if (!response.paging?.next || !after || data.length === 0) {
      break;
    }
  }

  return pages;
}

/**
 * Return accessible Pages without exposing their tokens.
 */
async function getAvailablePages(adminUid) {
  const connection = await getAdminConnection(adminUid);

  const pages = await fetchAccessiblePages(
    connection.userAccessToken
  );

  const existingSnapshot = await db
    .collection(PAGES_COLLECTION)
    .where('adminUid', '==', connection.uid)
    .get();

  const selectedIds = new Set(
    existingSnapshot.docs
      .filter(doc => doc.data()?.selected === true)
      .map(doc => doc.id)
  );

  return pages.map(page => ({
    pageId: page.pageId,
    pageName: page.pageName,
    category: page.category,
    tasks: page.tasks,
    selected: selectedIds.has(page.pageId)
  }));
}

/**
 * Save selected Facebook Pages.
 *
 * selectedPageIds must contain IDs returned by getAvailablePages().
 * Tokens are encrypted before Firestore storage.
 */
async function saveSelectedPages(adminUid, selectedPageIds) {
  const connection = await getAdminConnection(adminUid);

  if (!Array.isArray(selectedPageIds)) {
    throw new FacebookError(
      'Selected Page IDs must be an array.',
      400,
      'INVALID_SELECTED_PAGES'
    );
  }

  const uniqueIds = [
    ...new Set(
      selectedPageIds.map(id => cleanString(id, 50))
    )
  ];

  if (uniqueIds.some(id => !isValidPageId(id))) {
    throw new FacebookError(
      'One or more Facebook Page IDs are invalid.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  const accessiblePages = await fetchAccessiblePages(
    connection.userAccessToken
  );

  const accessibleById = new Map(
    accessiblePages.map(page => [page.pageId, page])
  );

  for (const pageId of uniqueIds) {
    if (!accessibleById.has(pageId)) {
      throw new FacebookError(
        `Facebook Page ${pageId} is not accessible to the connected account.`,
        403,
        'PAGE_NOT_ACCESSIBLE'
      );
    }
  }

  const existingSnapshot = await db
    .collection(PAGES_COLLECTION)
    .where('adminUid', '==', connection.uid)
    .get();

  const existingById = new Map(
    existingSnapshot.docs.map(doc => [
      doc.id,
      doc.data() || {}
    ])
  );

  const selectedSet = new Set(uniqueIds);
  const now = new Date();

  const writes = [];

  // Mark previously stored Pages as selected or unselected.
  for (const doc of existingSnapshot.docs) {
    const pageId = doc.id;

    if (!selectedSet.has(pageId)) {
      writes.push({
        ref: doc.ref,
        data: {
          selected: false,
          updatedAt: now
        }
      });
    }
  }

  // Store selected Page metadata and encrypted Page tokens.
  for (const pageId of uniqueIds) {
    const page = accessibleById.get(pageId);
    const existing = existingById.get(pageId) || {};

    writes.push({
      ref: db.collection(PAGES_COLLECTION).doc(pageId),
      data: {
        adminUid: connection.uid,
        pageId: page.pageId,
        pageName: page.pageName,
        category: page.category,
        tasks: page.tasks,
        pageAccessTokenEncrypted: encryptToken(
          page.pageAccessToken
        ),
        selected: true,
        connectedAt: existing.connectedAt || now,
        updatedAt: now
      }
    });
  }

  // Firestore batches support up to 500 writes.
  for (
    let index = 0;
    index < writes.length;
    index += WRITE_BATCH_SIZE
  ) {
    const batch = db.batch();

    const chunk = writes.slice(
      index,
      index + WRITE_BATCH_SIZE
    );

    for (const write of chunk) {
      batch.set(write.ref, write.data, { merge: true });
    }

    await batch.commit();
  }

  return {
    selectedCount: uniqueIds.length,
    selectedPages: uniqueIds.map(pageId => {
      const page = accessibleById.get(pageId);

      return {
        pageId: page.pageId,
        pageName: page.pageName,
        category: page.category
      };
    })
  };
}

/**
 * Get selected Pages without returning access tokens.
 */
async function getSelectedPages(adminUid) {
  const uid = normalizeAdminUid(adminUid);

  const snapshot = await db
    .collection(PAGES_COLLECTION)
    .where('adminUid', '==', uid)
    .where('selected', '==', true)
    .get();

  return snapshot.docs.map(doc => {
    const data = doc.data() || {};

    return {
      pageId: data.pageId || doc.id,
      pageName: data.pageName || '',
      category: data.category || '',
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      selected: true
    };
  });
}

/**
 * Get a selected Page's decrypted token for backend use only.
 *
 * Never send this return value to the frontend.
 */
async function getSelectedPageToken(adminUid, pageId) {
  const uid = normalizeAdminUid(adminUid);
  const id = cleanString(pageId, 50);

  if (!isValidPageId(id)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  const snapshot = await db
    .collection(PAGES_COLLECTION)
    .doc(id)
    .get();

  if (!snapshot.exists) {
    throw new FacebookError(
      'Facebook Page was not found.',
      404,
      'PAGE_NOT_FOUND'
    );
  }

  const page = snapshot.data() || {};

  if (
    page.adminUid !== uid ||
    page.selected !== true
  ) {
    throw new FacebookError(
      'This Facebook Page is not selected or does not belong to this admin.',
      403,
      'PAGE_ACCESS_DENIED'
    );
  }

  if (!isEncryptedToken(page.pageAccessTokenEncrypted)) {
    throw new FacebookError(
      'Facebook Page token is missing or invalid.',
      401,
      'PAGE_TOKEN_INVALID'
    );
  }

  return decryptToken(page.pageAccessTokenEncrypted);
}

/**
 * Remove all stored Page connections belonging to an admin.
 */
async function removeAdminPages(adminUid) {
  const uid = normalizeAdminUid(adminUid);

  const snapshot = await db
    .collection(PAGES_COLLECTION)
    .where('adminUid', '==', uid)
    .get();

  for (
    let index = 0;
    index < snapshot.docs.length;
    index += WRITE_BATCH_SIZE
  ) {
    const batch = db.batch();

    const chunk = snapshot.docs.slice(
      index,
      index + WRITE_BATCH_SIZE
    );

    for (const doc of chunk) {
      batch.delete(doc.ref);
    }

    await batch.commit();
  }

  return {
    deletedCount: snapshot.size
  };
}

module.exports = {
  getAvailablePages,
  saveSelectedPages,
  getSelectedPages,
  getSelectedPageToken,
  removeAdminPages
};
