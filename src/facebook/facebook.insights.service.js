
'use strict';

const {
  FacebookError,
  cleanString,
  isValidPageId
} = require('./facebook.utils');

const {
  authenticatedGraphRequest
} = require('./facebook.graph');

const {
  getSelectedPageToken
} = require('./facebook.connection.service');

// ========================================
// Constants
// ========================================

const MAX_DATE_RANGE_DAYS = 90;

const PAGE_METRICS = [
  'page_posts_impressions',
  'page_posts_impressions_unique',
  'page_post_engagements',
  'page_media_view',
  'page_daily_follows_unique'
];

const POST_METRICS = [
  'post_media_view',
  'post_total_media_view_unique',
  'post_reactions_by_type_total',
  'post_clicks',
  'post_clicks_by_type'
];

// ========================================
// Admin UID
// ========================================

function normalizeAdminUid(adminUid) {
  const uid = cleanString(adminUid, 128);

  if (!uid) {
    throw new FacebookError(
      'Admin authentication required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  return uid;
}

// ========================================
// Page ID
// ========================================

function normalizePageId(pageId) {
  const id = cleanString(pageId, 50);

  if (!isValidPageId(id)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  return id;
}

// ========================================
// Post ID
// ========================================

function normalizePostId(postId, pageId) {
  const id = cleanString(postId, 100);

  /*
   * Facebook Page post IDs are normally:
   * PAGE_ID_POST_ID
   *
   * Some Graph API objects may return a numeric ID.
   * The Page access token still validates access.
   */

  if (!/^\d{5,30}(?:_\d{1,30})?$/.test(id)) {
    throw new FacebookError(
      'Invalid Facebook Post ID.',
      400,
      'INVALID_POST_ID'
    );
  }

  if (
    id.includes('_') &&
    !id.startsWith(`${pageId}_`)
  ) {
    throw new FacebookError(
      'The Post ID does not belong to the selected Page.',
      403,
      'POST_PAGE_MISMATCH'
    );
  }

  return id;
}

// ========================================
// Date Helpers
// ========================================

function parseDate(value, fieldName, isEndDate = false) {
  if (!value) return null;

  const input = cleanString(value, 50);

  let date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    date = new Date(
      `${input}T${isEndDate ? '23:59:59.999' : '00:00:00.000'}Z`
    );
  } else {
    date = new Date(input);
  }

  if (Number.isNaN(date.getTime())) {
    throw new FacebookError(
      `Invalid ${fieldName} date.`,
      400,
      'INVALID_INSIGHTS_DATE'
    );
  }

  return date;
}

function normalizeDateRange(filters = {}) {
  const now = new Date();

  const until = parseDate(
    filters.until || filters.endDate,
    'until',
    true
  ) || now;

  const since = parseDate(
    filters.since || filters.startDate,
    'since',
    false
  ) || new Date(
    until.getTime() -
    27 * 24 * 60 * 60 * 1000
  );

  if (since > until) {
    throw new FacebookError(
      'Start date must be before end date.',
      400,
      'INVALID_INSIGHTS_DATE_RANGE'
    );
  }

  if (until > now) {
    throw new FacebookError(
      'Insights end date cannot be in the future.',
      400,
      'INSIGHTS_DATE_IN_FUTURE'
    );
  }

  const rangeDays = Math.ceil(
    (until.getTime() - since.getTime()) /
    (24 * 60 * 60 * 1000)
  );

  if (rangeDays > MAX_DATE_RANGE_DAYS) {
    throw new FacebookError(
      `Insights date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`,
      400,
      'INSIGHTS_DATE_RANGE_TOO_LARGE'
    );
  }

  return {
    since,
    until,

    sinceTimestamp: Math.floor(
      since.getTime() / 1000
    ),

    untilTimestamp: Math.floor(
      until.getTime() / 1000
    )
  };
}

// ========================================
// Normalize Insights Response
// ========================================

function normalizeInsights(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(item => ({
    name: cleanString(item.name, 150),

    title: cleanString(
      item.title,
      300
    ),

    description: cleanString(
      item.description,
      1000
    ),

    period: cleanString(
      item.period,
      50
    ),

    values: Array.isArray(item.values)
      ? item.values.map(value => ({
          endTime: value.end_time || null,
          value: value.value ?? null
        }))
      : []
  }));
}

// ========================================
// Page Insights Summary
// ========================================

function getNumericTotal(metric) {
  if (!metric || !Array.isArray(metric.values)) {
    return 0;
  }

  return metric.values.reduce((total, item) => {
    const value = Number(item.value);

    if (!Number.isFinite(value)) {
      return total;
    }

    return total + value;
  }, 0);
}

function summarizePageInsights(metrics) {
  const findMetric = name => metrics.find(
    metric => metric.name === name
  );

  const impressions = findMetric(
    'page_posts_impressions'
  );

  const reach = findMetric(
    'page_posts_impressions_unique'
  );

  const engagements = findMetric(
    'page_post_engagements'
  );

  const mediaViews = findMetric(
    'page_media_view'
  );

  const follows = findMetric(
    'page_daily_follows_unique'
  );

  return {
    impressions: getNumericTotal(impressions),

    engagements: getNumericTotal(engagements),

    mediaViews: getNumericTotal(mediaViews),

    follows: getNumericTotal(follows),

    /*
     * Do not sum daily unique reach.
     * The same person may be counted on multiple days.
     */

    reachByDay: reach?.values || [],

    reachTotal: null,

    reachNote:
      'Daily unique reach is not summed because the same person may appear on multiple days.'
  };
}

// ========================================
// Get Page Insights
// ========================================

async function getPageInsights(
  adminUid,
  pageId,
  filters = {}
) {
  const uid = normalizeAdminUid(adminUid);

  const normalizedPageId = normalizePageId(
    pageId
  );

  const dateRange = normalizeDateRange(
    filters
  );

  /*
   * This helper verifies that the Page is selected,
   * belongs to the admin and has a valid stored token.
   */

  const pageAccessToken = await getSelectedPageToken(
    uid,
    normalizedPageId
  );

  const response = await authenticatedGraphRequest(
    `${normalizedPageId}/insights`,
    pageAccessToken,
    {
      method: 'GET',

      params: {
        metric: PAGE_METRICS.join(','),

        period: 'day',

        since: dateRange.sinceTimestamp,

        until: dateRange.untilTimestamp
      }
    }
  );

  const metrics = normalizeInsights(
    response.data
  );

  return {
    pageId: normalizedPageId,

    dateRange: {
      since: dateRange.since.toISOString(),
      until: dateRange.until.toISOString()
    },

    metrics,

    summary: summarizePageInsights(
      metrics
    )
  };
}

// ========================================
// Get Post Insights
// ========================================

async function getPostInsights(
  adminUid,
  pageId,
  postId
) {
  const uid = normalizeAdminUid(adminUid);

  const normalizedPageId = normalizePageId(
    pageId
  );

  const normalizedPostId = normalizePostId(
    postId,
    normalizedPageId
  );

  const pageAccessToken = await getSelectedPageToken(
    uid,
    normalizedPageId
  );

  const response = await authenticatedGraphRequest(
    `${normalizedPostId}/insights`,
    pageAccessToken,
    {
      method: 'GET',

      params: {
        metric: POST_METRICS.join(','),

        period: 'lifetime'
      }
    }
  );

  return {
    pageId: normalizedPageId,

    postId: normalizedPostId,

    metrics: normalizeInsights(
      response.data
    )
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  getPageInsights,
  getPostInsights,
  normalizeDateRange,
  normalizeInsights,
  summarizePageInsights
};
