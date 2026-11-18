'use strict';

import { escapeHTML } from '../../helpers.js';
import {
  formatNumber,
  formatMoney,
  getProductName,
  getProductStatus,
  getProductImages,
  getProductTags,
  getProductVariants,
  getStockInfo,
  getPricingInfo,
  getProductDetails,
  getProductLots
} from './product-data.js';

// ========================================
// SMALL HTML BUILDERS
// ========================================

function detailRow(label, value) {
  return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(String(value ?? '—'))}</dd></div>`;
}

function statCard(label, value, extraClass = '') {
  return `
    <div class="${extraClass}">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(String(value))}</strong>
    </div>
  `;
}

function section(title, content) {
  return `
    <section class="product-view-section">
      <h5>${escapeHTML(title)}</h5>
      ${content}
    </section>
  `;
}

// ========================================
// SECTION RENDERERS
// ========================================

function renderGallery(images, name) {
  if (!images.length) {
    return '<div class="product-view-image"><span aria-hidden="true">📦</span></div>';
  }

  const thumbs = images.length > 1
    ? `<div class="product-view-thumbs">
        ${images.map((src, index) => `
          <button type="button" class="product-view-thumb${index === 0 ? ' is-active' : ''}"
            data-view-image="${escapeHTML(src)}" aria-label="Image ${index + 1}">
            <img src="${escapeHTML(src)}" alt="">
          </button>
        `).join('')}
      </div>`
    : '';

  return `
    <div class="product-view-gallery">
      <div class="product-view-image">
        <img id="product-view-main-image" src="${escapeHTML(images[0])}"
          alt="${escapeHTML(name)}">
      </div>
      ${thumbs}
    </div>
  `;
}

function renderPricing(pricing) {
  const cards = [
    statCard('Selling Price', formatMoney(pricing.selling))
  ];

  if (pricing.compare > 0) {
    cards.push(statCard('Regular / MRP', formatMoney(pricing.compare)));
  }
  if (pricing.discount !== null) {
    cards.push(statCard('Discount', `${pricing.discount.toFixed(1)}%`));
  }
  if (pricing.cost > 0) {
    cards.push(statCard('Cost Price', formatMoney(pricing.cost)));
  }
  if (pricing.profit !== null) {
    cards.push(statCard('Profit / Unit', formatMoney(pricing.profit)));
    cards.push(statCard('Margin', `${pricing.margin.toFixed(1)}%`));
  }

  return section('Pricing', `<div class="product-view-stats">${cards.join('')}</div>`);
}

function renderInventory(stock, lotCount) {
  const cards = [
    statCard('Available', formatNumber(stock.available), `stock-${stock.level}`),
    statCard('Reserved', formatNumber(stock.reserved)),
    statCard('Total', formatNumber(stock.total)),
    statCard('Low Stock Alert', formatNumber(stock.threshold)),
    statCard('Purchase Lots', formatNumber(lotCount))
  ];

  return section('Inventory', `
    <p class="product-view-stock-label stock-${stock.level}">
      ${escapeHTML(stock.label)}
    </p>
    <div class="product-view-stats">${cards.join('')}</div>
  `);
}

function renderVariants(variants) {
  if (!variants.length) {
    return section('Variants', '<p class="product-view-muted">No variants added.</p>');
  }

  const rows = variants.map(variant => `
    <tr>
      <td>${escapeHTML(String(variant.name))}</td>
      <td>${escapeHTML(String(variant.sku))}</td>
      <td>${escapeHTML(String(variant.size))}</td>
      <td>${escapeHTML(String(variant.color))}</td>
      <td>${escapeHTML(formatMoney(variant.price))}</td>
      <td>${escapeHTML(formatNumber(variant.stock))}</td>
    </tr>
  `).join('');

  return section(`Variants (${variants.length})`, `
    <div class="product-view-table-wrap">
      <table class="product-view-table">
        <thead>
          <tr>
            <th>Name</th><th>SKU</th><th>Size</th>
            <th>Color</th><th>Price</th><th>Stock</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `);
}

function renderLotVariants(variants) {
  if (!variants.length) {
    return '<p class="product-view-muted">No variant breakdown was saved for this lot.</p>';
  }

  return `
    <div class="product-view-table-wrap product-view-lot-variants">
      <table class="product-view-table">
        <thead>
          <tr>
            <th>SKU</th><th>Color</th><th>Size</th><th>Purchased</th>
            <th>Sold</th><th>Remaining</th><th>Buy / Unit</th>
            <th>Landed / Unit</th><th>Stock Value</th>
          </tr>
        </thead>
        <tbody>
          ${variants.map(variant => `
            <tr>
              <td>${escapeHTML(String(variant.sku))}</td>
              <td>${escapeHTML(String(variant.color))}</td>
              <td>${escapeHTML(String(variant.size))}</td>
              <td>${escapeHTML(formatNumber(variant.purchased))}</td>
              <td>${escapeHTML(formatNumber(variant.sold))}</td>
              <td><strong>${escapeHTML(formatNumber(variant.remaining))}</strong></td>
              <td>${escapeHTML(formatMoney(variant.buyPrice))}</td>
              <td>${escapeHTML(formatMoney(variant.landedCost))}</td>
              <td>${escapeHTML(formatMoney(variant.stockValue))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLots(lots, loading = false) {
  if (loading) {
    return section('Purchase Lots', '<p class="product-view-muted">Loading purchase lot details...</p>');
  }

  if (!lots.length) {
    return section('Purchase Lots', '<p class="product-view-muted">No lot data found.</p>');
  }

  const totals = lots.reduce((sum, lot) => ({
    purchased: sum.purchased + lot.purchased,
    sold: sum.sold + lot.sold,
    remaining: sum.remaining + lot.remaining,
    value: sum.value + lot.stockValue
  }), { purchased: 0, sold: 0, remaining: 0, value: 0 });

  const cards = lots.map(lot => `
    <article class="product-view-lot-card">
      <header class="product-view-lot-header">
        <div>
          <strong>${escapeHTML(String(lot.lotName))}</strong>
          <span>${escapeHTML(String(lot.lotNo))}</span>
        </div>
        <span class="product-view-lot-status product-view-lot-${escapeHTML(lot.status)}">
          ${escapeHTML(lot.status)}
        </span>
      </header>

      <dl class="product-view-lot-meta">
        ${detailRow('Supplier', lot.supplier)}
        ${detailRow('Purchase Date', lot.date)}
        ${detailRow('Purchased', formatNumber(lot.purchased))}
        ${detailRow('Sold', formatNumber(lot.sold))}
        ${detailRow('Remaining', formatNumber(lot.remaining))}
        ${detailRow('Average Buy / Unit', formatMoney(lot.buyPrice))}
        ${detailRow('Average Landed / Unit', formatMoney(lot.unitLandedCost))}
        ${detailRow('Purchase Cost', formatMoney(lot.purchaseCost))}
        ${detailRow('Transport Cost', formatMoney(lot.transportCost))}
        ${detailRow('Other Cost', formatMoney(lot.otherCost))}
        ${detailRow('Total Landed Cost', formatMoney(lot.landedCost))}
        ${detailRow('Remaining Stock Value', formatMoney(lot.stockValue))}
      </dl>

      ${lot.note ? `
        <p class="product-view-lot-note"><strong>Note:</strong> ${escapeHTML(String(lot.note))}</p>
      ` : ''}

      <details class="product-view-lot-details" ${lot.variants.length === 1 ? 'open' : ''}>
        <summary>Variant breakdown (${lot.variants.length})</summary>
        ${renderLotVariants(lot.variants)}
      </details>
    </article>
  `).join('');

  return section(`Purchase Lots (${lots.length})`, `
    <div class="product-view-stats">
      ${statCard('Total Purchased', formatNumber(totals.purchased))}
      ${statCard('Total Sold', formatNumber(totals.sold))}
      ${statCard('Total Remaining', formatNumber(totals.remaining))}
      ${statCard('Stock Value (cost)', formatMoney(totals.value))}
    </div>
    <div class="product-view-lot-list">${cards}</div>
  `);
}

function renderTags(tags) {
  if (!tags.length) return '';

  return section('Tags', `
    <div class="product-view-tags">
      ${tags.map(tag => `<span class="product-view-tag">${escapeHTML(tag)}</span>`).join('')}
    </div>
  `);
}

function renderBasicInfo(details) {
  return section('Product Information', `
    <dl class="product-view-details">
      ${detailRow('SKU', details.sku)}
      ${detailRow('Product Code', details.productCode)}
      ${detailRow('Barcode', details.barcode)}
      ${detailRow('Brand', details.brand)}
      ${detailRow('Collection', details.collection)}
      ${detailRow('Category', details.category)}
      ${detailRow('Sub Category', details.subCategory)}
      ${detailRow('Fabric / Material', details.material)}
      ${detailRow('Fit', details.fit)}
      ${detailRow('Sleeve Type', details.sleeveType)}
      ${detailRow('Wash Care', details.washCare)}
      ${detailRow('Weight', details.weight)}
      ${detailRow('Default Supplier', details.supplier)}
      ${detailRow('Slug', details.slug)}
      ${detailRow('Created', details.createdAt)}
      ${detailRow('Last Updated', details.updatedAt)}
    </dl>
  `);
}

function renderDescription(details) {
  const text = details.description || details.shortDescription;

  return section('Description', `
    <p class="product-view-description">
      ${escapeHTML(String(text || 'No description added.'))}
    </p>
  `);
}

function renderSeo(details) {
  return section('SEO', `
    <dl class="product-view-details">
      ${detailRow('SEO Title', details.seoTitle)}
      ${detailRow('SEO Description', details.seoDescription)}
    </dl>
  `);
}

function renderMerchandising(details) {
  const enabledFlags = [
    details.flags.newArrival ? 'New Arrival' : '',
    details.flags.featured ? 'Featured' : '',
    details.flags.bestSeller ? 'Best Seller' : ''
  ].filter(Boolean);

  return section('Sales & Merchandising', `
    <div class="product-view-stats">
      ${statCard('Average Rating', `${details.ratingAvg.toFixed(1)} / 5`)}
      ${statCard('Review Count', formatNumber(details.ratingCount))}
      ${statCard('Sold Count', formatNumber(details.soldCount))}
    </div>
    <div class="product-view-tags">
      ${(enabledFlags.length ? enabledFlags : ['No merchandising flags'])
        .map(flag => `<span class="product-view-tag">${escapeHTML(flag)}</span>`).join('')}
    </div>
    ${details.purchaseNote ? `
      <p class="product-view-description"><strong>Purchase note:</strong> ${escapeHTML(details.purchaseNote)}</p>
    ` : ''}
  `);
}

// ========================================
// BUILD FULL VIEW HTML
// ========================================

function buildProductViewHTML(product) {
  const name = getProductName(product);
  const status = getProductStatus(product);
  const details = getProductDetails(product);

  return `
    <div class="product-view-hero">
      ${renderGallery(getProductImages(product), name)}

      <div class="product-view-heading">
        <span class="product-status product-status-${escapeHTML(status)}">
          ${escapeHTML(status)}
        </span>
        <h4>${escapeHTML(name)}</h4>
        <p>${escapeHTML(String(details.shortDescription || details.brand || ''))}</p>
      </div>
    </div>

    ${renderPricing(getPricingInfo(product))}
    ${renderInventory(getStockInfo(product), details.lotCount)}
    ${renderVariants(getProductVariants(product))}
    ${renderLots(getProductLots(product), product.lotsLoading === true)}
    ${renderBasicInfo(details)}
    ${renderDescription(details)}
    ${renderMerchandising(details)}
    ${renderTags(getProductTags(product))}
    ${renderSeo(details)}
  `;
}

// ========================================
// GALLERY CLICK (thumbnail -> main image)
// ========================================

function bindGallery(modal) {
  if (modal.dataset.galleryBound === 'true') return;

  modal.dataset.galleryBound = 'true';

  modal.addEventListener('click', event => {
    const thumb = event.target.closest('[data-view-image]');
    if (!thumb) return;

    const main = modal.querySelector('#product-view-main-image');
    if (main) main.src = thumb.dataset.viewImage;

    modal.querySelectorAll('.product-view-thumb').forEach(item => {
      item.classList.toggle('is-active', item === thumb);
    });
  });
}

// ========================================
// PUBLIC API
// ========================================

export function renderProductView(pageRoot, product, { activating = false } = {}) {
  if (!pageRoot || !product) return;

  const body = pageRoot.querySelector('#product-view-body');
  const title = pageRoot.querySelector('#product-view-title');
  const activateButton = pageRoot.querySelector('[data-products-action="activate-view"]');
  const editButton = pageRoot.querySelector('[data-products-action="edit-view"]');

  if (title) title.textContent = getProductName(product);
  if (body) body.innerHTML = buildProductViewHTML(product);

  if (activateButton) {
    activateButton.hidden = getProductStatus(product) !== 'draft';
    activateButton.disabled = activating;
    activateButton.dataset.productId = product.id;
    activateButton.textContent = activating ? 'Activating...' : 'Activate Product';
  }

  if (editButton) editButton.dataset.productId = product.id;
}

export function openProductView(pageRoot, product, options = {}) {
  const modal = pageRoot?.querySelector('#product-view-modal');

  if (!modal || !product?.id) return false;

  renderProductView(pageRoot, product, options);
  bindGallery(modal);

  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => (
    modal.querySelector('[data-products-action="close-view"]')?.focus()
  ), 0);

  return true;
}

export function closeProductView(pageRoot) {
  const modal = pageRoot?.querySelector('#product-view-modal');
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}
