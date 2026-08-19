const socket = io();
const driverId = localStorage.getItem('userId');
const driverName = localStorage.getItem('userName') || 'Driver';
// Which ride category (Bike/Mini/Standard/XL) this driver is dispatched
// requests for, derived from their registered vehicle at signup (see
// classifyVehicle in routes/authRoute.js). Saver requests go to anyone.
const myVehicleCategory = localStorage.getItem('vehicleCategory') || null;

// Surface the auto-detected category to the driver (side menu).
const CATEGORY_LABEL = { bike: '🏍️ Bike driver', mini: '🚙 Mini driver', standard: '🚗 Standard driver', xl: '🚐 XL driver' };
if (myVehicleCategory) {
  const catEl = document.getElementById('driver-category');
  if (catEl) catEl.textContent = CATEGORY_LABEL[myVehicleCategory] || myVehicleCategory;
}

// How the driver gets paid (card or voucher) + the app's commission. The app
// keeps 10% of every fare, so the driver receives 90% of the gross.
const COMMISSION_RATE = 0.10;
let payoutMethod = localStorage.getItem('payoutMethod') || 'card';
function setPayoutMethod(m) {
  payoutMethod = m;
  localStorage.setItem('payoutMethod', m);
  // Persist to the driver's account so the choice survives re-login.
  try {
    fetch('/api/auth/payout', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: driverId, payoutMethod: m })
    });
  } catch (e) { /* ignore */ }
}
function netOfCommission(gross) { return parseFloat(gross || 0) * (1 - COMMISSION_RATE); }

// Cash-out history: each time the driver withdraws their available earnings
// to their chosen method (card/voucher), it's recorded and shown here.
const CASHOUT_METHOD_LABEL = { card: '💳 Card', voucher: '🎟️ Voucher' };
let cashouts = [];
async function loadCashouts() {
  try {
    const res = await fetch(`/api/cashouts?driverId=${driverId}`);
    const data = await res.json();
    cashouts = Array.isArray(data) ? data : [];
  } catch { cashouts = []; }
  return cashouts;
}
function totalCashedOut() { return cashouts.reduce((s, c) => s + parseFloat(c.amount || 0), 0); }

function renderCashoutHistory() {
  const el = document.getElementById('cashout-history');
  if (!el) return;
  if (!cashouts.length) { el.innerHTML = '<div style="color:#888;">No cash outs yet.</div>'; return; }
  el.innerHTML = cashouts.map(c => {
    const date = new Date(c.createdAt).toLocaleString();
    return `<div class="cashout-item"><span>${CASHOUT_METHOD_LABEL[c.method] || c.method} · R${parseFloat(c.amount).toFixed(2)}</span><span style="color:#888; font-size:0.75rem;">${date}</span></div>`;
  }).join('');
}

if (!driverId) window.location.href = 'login.html';
document.getElementById('driver-name').textContent = driverName;

// --- DOM REFS ---
const mapContainer = document.getElementById('driver-map');
const goOnlineBtn = document.getElementById('go-online-btn');
const bottomSheet = document.getElementById('bottom-sheet');
const driverRides = document.getElementById('driver-rides');
const menuBtn = document.getElementById('menu-btn');
const sideMenu = document.getElementById('side-menu');
const sideOverlay = document.getElementById('side-overlay');
const safetyBtn = document.getElementById('safety-btn');
const safetyModal = document.getElementById('safety-modal');
const safetyClose = document.getElementById('safety-close');
const pageContainer = document.getElementById('page-container');
const pageTitle = document.getElementById('page-title');
const pageContent = document.getElementById('page-content');
const navItems = document.querySelectorAll('.nav-item');
const logoutMenuItem = document.getElementById('logout-menu-item');

// --- CHAT DOM REFS ---
const chatModal = document.getElementById('chat-modal');
const chatHandle = document.getElementById('chat-handle');
const chatWithName = document.getElementById('chat-with-name');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const closeChat = document.getElementById('close-chat');
let currentRiderId = null;
let currentRiderName = 'Rider';

// --- CONFIRMATION CODE MODAL REFS (driver enters the passenger's code to start) ---
const codeModal = document.getElementById('code-modal');
const codeInput = document.getElementById('code-input');
const codeError = document.getElementById('code-error');
const codeCancel = document.getElementById('code-cancel');
const codeConfirm = document.getElementById('code-confirm');
let pendingStartRideId = null;

const RIDE_TYPE_LABELS = { bike: '🏍️ Bike', mini: '🚙 Mini', standard: '🚗 Standard', saver: '💸 Saver' };

// --- PAYMENT INFO DOM REFS (read-only — shows how the rider is paying) ---
const paymentModal = document.getElementById('payment-modal');
const paymentHandle = document.getElementById('payment-handle');
const paymentInfoRow = document.getElementById('payment-info-row');
const closePayment = document.getElementById('close-payment');
const PAYMENT_LABELS = { cash: '💵 Cash', card: '💳 Card' };

// --- DRAGGABLE BOTTOM SHEET (used by chat, payment info, and ride requests) ---
// Height-driven so it plays nicely with the sheet's own internal scrolling.
// Drag the handle up/down between minVH/maxVH. If `closable` (default true),
// dragging below ~60% of minVH hides the sheet entirely; otherwise (used for
// the ride-request sheet, which shouldn't vanish just because it was
// dragged down) it clamps to minVH instead.
function makeDragSheet(sheetEl, handleEl, { minVH = 32, maxVH = 88, startVH = 55, closable = true } = {}) {
  const appEl = sheetEl.parentElement;
  let dragging = false, startY = 0, startHeightPx = 0;

  function vhToPx(vh) { return (appEl.clientHeight * vh) / 100; }

  function open() {
    sheetEl.classList.remove('hidden');
    sheetEl.style.transition = 'none';
    sheetEl.style.height = `${vhToPx(startVH)}px`;
    void sheetEl.offsetHeight; // force layout before any later transitioned change
    sheetEl.style.transition = '';
  }
  function close() {
    sheetEl.style.transition = 'height 0.2s ease';
    sheetEl.style.height = '0px';
    setTimeout(() => sheetEl.classList.add('hidden'), 200);
  }

  function onPointerDown(e) {
    dragging = true;
    startY = e.clientY;
    startHeightPx = sheetEl.getBoundingClientRect().height;
    sheetEl.style.transition = 'none';
    handleEl.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const delta = startY - e.clientY; // dragging up = positive
    const newHeight = Math.min(vhToPx(maxVH), Math.max(0, startHeightPx + delta));
    sheetEl.style.height = `${newHeight}px`;
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const heightPx = sheetEl.getBoundingClientRect().height;
    const minPx = vhToPx(minVH);
    if (heightPx < minPx * 0.6) {
      if (closable) { close(); return; }
      sheetEl.style.transition = 'height 0.2s ease';
      sheetEl.style.height = `${minPx}px`; // clamp instead of hiding
      return;
    }
    const midPx = vhToPx((minVH + maxVH) / 2);
    const maxPx = vhToPx(maxVH);
    const stops = [minPx, midPx, maxPx];
    const nearest = stops.reduce((a, b) => Math.abs(b - heightPx) < Math.abs(a - heightPx) ? b : a);
    sheetEl.style.transition = 'height 0.2s ease';
    sheetEl.style.height = `${nearest}px`;
  }

  handleEl.addEventListener('pointerdown', onPointerDown);
  handleEl.addEventListener('pointermove', onPointerMove);
  handleEl.addEventListener('pointerup', onPointerUp);
  handleEl.addEventListener('pointercancel', onPointerUp);

  return { open, close };
}

const chatSheet = makeDragSheet(chatModal, chatHandle, { minVH: 32, maxVH: 88, startVH: 55 });
const paymentSheet = makeDragSheet(paymentModal, paymentHandle, { minVH: 25, maxVH: 55, startVH: 35 });

// Ride-request sheet: capped so its top reaches the middle of the app but
// never passes it (the sheet sits above the 70px bottom nav, so 40vh of app
// height lands its top right at ~50% of the screen). Scrolls internally.
// Not closable by dragging — these are actionable requests, not a dismissable panel.
const bottomSheetHandleEl = document.getElementById('bottom-sheet-handle');
const requestSheet = makeDragSheet(bottomSheet, bottomSheetHandleEl, { minVH: 20, maxVH: 40, startVH: 30, closable: false });
let requestSheetVisible = false; // tracks whether it's showing at all (vs. just its drag position)

function showRequestSheet() {
  if (!requestSheetVisible) { requestSheet.open(); requestSheetVisible = true; }
}
function hideRequestSheet() {
  requestSheet.close();
  requestSheetVisible = false;
}

// --- REQUEST RADIUS (driver-adjustable, 1km-80km) ---
const radiusModal = document.getElementById('radius-modal');
const radiusHandle = document.getElementById('radius-handle');
const radiusPillBtn = document.getElementById('radius-pill-btn');
const closeRadius = document.getElementById('close-radius');
const radiusSlider = document.getElementById('radius-slider');
const radiusValueDisplay = document.getElementById('radius-value-display');
const radiusSheet = makeDragSheet(radiusModal, radiusHandle, { minVH: 32, maxVH: 60, startVH: 40 });

const MIN_REQUEST_RADIUS_KM = 1;
const MAX_REQUEST_RADIUS_KM = 80;
const DEFAULT_REQUEST_RADIUS_KM = 8; // within the "5-8km" default range requested

let requestRadiusKm = parseInt(localStorage.getItem('requestRadiusKm'), 10);
if (!requestRadiusKm || requestRadiusKm < MIN_REQUEST_RADIUS_KM || requestRadiusKm > MAX_REQUEST_RADIUS_KM) {
  requestRadiusKm = DEFAULT_REQUEST_RADIUS_KM;
}
radiusSlider.value = requestRadiusKm;
radiusValueDisplay.textContent = `${requestRadiusKm} km`;
radiusPillBtn.textContent = `📍 ${requestRadiusKm}km`;

radiusPillBtn.addEventListener('click', () => radiusSheet.open());
closeRadius.addEventListener('click', () => radiusSheet.close());
radiusSlider.addEventListener('input', () => {
  requestRadiusKm = parseInt(radiusSlider.value, 10);
  radiusValueDisplay.textContent = `${requestRadiusKm} km`;
  radiusPillBtn.textContent = `📍 ${requestRadiusKm}km`;
});
// Only push the change (and persist it) once the driver lets go of the
// slider, rather than spamming the server on every intermediate value.
radiusSlider.addEventListener('change', () => {
  localStorage.setItem('requestRadiusKm', requestRadiusKm);
  if (isOnline) socket.emit('driver-radius', { radiusKm: requestRadiusKm });
});

function openPaymentInfo(method) {
  paymentInfoRow.innerHTML = `${PAYMENT_LABELS[method] || PAYMENT_LABELS.cash} <span>${method === 'card' ? 'Card •••• 4242' : 'Cash'}</span>`;
  paymentSheet.open();
}
closePayment.addEventListener('click', () => paymentSheet.close());

// --- MAP SETUP ---
const map = L.map('driver-map').setView([-29.8587, 31.0218], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

// 🚗 DRIVER CAR ICON (Better for driver to see themselves)
const driverCarIcon = L.divIcon({
  className: 'driver-car-icon',
  html: '🚗',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});
let driverMarker = L.marker([-29.8587, 31.0218], { icon: driverCarIcon }).addTo(map);

const pickupIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25,41], iconAnchor: [12,41] });
const dropoffIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25,41], iconAnchor: [12,41] });
let pickupMarker = null;
let dropoffMarkerDriver = null;
let routeLine = null;       // live route: driver's current position -> current target (pickup, then dropoff)
let tripRouteLine = null;   // reference route: full pickup -> dropoff path for the whole trip

// --- STATE ---
let currentDriverLat = -29.8587;
let currentDriverLng = 31.0218;
let hasRealFix = false;
let isOnline = false;
let activeRideId = null;
let activeRideDropoff = null;
let moveInterval = null;

// Moving/stationary detection: samples successive positions and broadcasts
// whether the car is actually moving (rider shows "moving" vs "stationary").
let lastPos = null;
let lastMoveTime = null;
let driverMoving = true;

// Waiting-fee model (mirrors the server): the first 2 minutes after the
// driver clicks "Arrived at pickup" are free, then R0.20 accrues every 20s
// until the ride starts.
const FREE_WAIT_MS = 2 * 60 * 1000;
const WAIT_FEE_PERIOD_MS = 20 * 1000;
const WAIT_FEE_PER_PERIOD = 0.20;
let currentArrivedAt = null;      // server timestamp of "Arrived at pickup"
let waitingTimerInterval = null;  // driver-side live waiting-fee countdown
let currentRideCost = 0;          // base fare of the active ride (for display)

// Keep the map centered ("follow me") on the driver's car at all times —
// pans without changing zoom so the driver never loses sight of themselves.
function centerOnDriver() {
  map.panTo([currentDriverLat, currentDriverLng], { animate: false });
}

// Ride requests further than the driver's chosen radius (see requestRadiusKm,
// adjustable 1-80km) are never shown to them — server already filters
// dispatch by this same value; this is the client-side mirror for the direct
// GET on load/going online.
const RIDE_REQUEST_TIMEOUT_MS = 40000; // 40s to Accept/Decline before it auto-hides

// Rides this driver declined or let time out — hidden from them (but still
// fully visible/acceptable to every other driver; nothing changes server-side).
const ignoredRideIds = new Set();
// rideId -> { timeoutId, intervalId } so a card's countdown can be cancelled
// the moment it's accepted, declined, or taken by someone else.
const rideTimers = {};

// --- HELPER: CALCULATE STRAIGHT-LINE DISTANCE (km) ---
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// --- MOVING / STATIONARY DETECTION ---
// Computes whether the car is actually moving from successive position
// samples (km/h from distance/time) and broadcasts it with driver-location so
// the rider can see "Driver is moving" vs "Driver is stationary". Falls back
// to an explicit `forcedMoving` when callers already know the state (e.g. the
// simulation stopping at pickup = stationary).
function reportPosition(lat, lng, rideId, forcedMoving) {
  const now = Date.now();
  let moving = forcedMoving;
  if (typeof moving !== 'boolean') {
    if (lastPos && lastMoveTime) {
      const distKm = calculateDistance(lastPos.lat, lastPos.lng, lat, lng);
      const dtSec = (now - lastMoveTime) / 1000;
      const speedKmh = dtSec > 0 ? (distKm / dtSec) * 3600 : 0;
      moving = speedKmh > 1.5; // below ~1.5 km/h counts as stationary
    } else {
      moving = true; // first sample — assume moving until proven otherwise
    }
  }
  lastPos = { lat, lng };
  lastMoveTime = now;
  driverMoving = moving;
  socket.emit('driver-location', { lat, lng, rideId, moving });
}

// --- DRIVER-SIDE WAITING TIMER (after "Arrived at pickup") ---
function clearDriverWaitingTimer() {
  if (waitingTimerInterval) { clearInterval(waitingTimerInterval); waitingTimerInterval = null; }
}
function startDriverWaitingTimer() {
  clearDriverWaitingTimer();
  if (!currentArrivedAt) return;
  waitingTimerInterval = setInterval(() => {
    const el = document.getElementById('waiting-info');
    if (!el) return;
    const elapsed = Date.now() - new Date(currentArrivedAt).getTime();
    if (elapsed < FREE_WAIT_MS) {
      const left = Math.ceil((FREE_WAIT_MS - elapsed) / 1000);
      el.textContent = `⏱ Passenger boarding — free wait ${left}s`;
    } else {
      const chargedMs = elapsed - FREE_WAIT_MS;
      const periods = Math.floor(chargedMs / WAIT_FEE_PERIOD_MS);
      const fee = periods * WAIT_FEE_PER_PERIOD;
      el.textContent = `💰 Waiting fee: +R${fee.toFixed(2)} (R0.20 / 20s)`;
    }
  }, 1000);
}

// --- HELPER: DISAMBIGUATE ADDRESSES (matches app.js's rider-side logic) ---
function formatAddress(item) {
  const addr = item.address || {};
  const primary = (item.display_name || '').split(',')[0].trim();
  const area = addr.suburb || addr.neighbourhood || addr.city_district || '';
  const city = addr.city || addr.town || addr.village || addr.county || '';
  const province = addr.state || addr.province || '';

  const parts = [primary];
  if (area && area !== primary) parts.push(area);
  if (city && city !== area && city !== primary) parts.push(city);
  if (province) parts.push(province);
  return parts.join(', ');
}

// Riders see a real address when booking — drivers should too, not raw
// coordinates. Cached by rounded lat/lng so repeat renders (e.g. the 40s
// countdown re-render) don't re-hit Nominatim for the same pickup point.
const pickupAddressCache = new Map();
async function resolvePickupAddress(ride, elId) {
  const key = `${ride.pickup.lat.toFixed(5)},${ride.pickup.lng.toFixed(5)}`;
  const fallback = `${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}`;

  // Rides booked with the new address fields already carry the pickup address
  // — no need to reverse-geocode.
  if (ride.pickupAddress) {
    const el = document.getElementById(elId);
    if (el) el.textContent = ride.pickupAddress;
    pickupAddressCache.set(key, ride.pickupAddress);
    return;
  }

  if (pickupAddressCache.has(key)) {
    const el = document.getElementById(elId);
    if (el) el.textContent = pickupAddressCache.get(key);
    return;
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${ride.pickup.lat}&lon=${ride.pickup.lng}&addressdetails=1`);
    const data = await res.json();
    const address = data.display_name ? formatAddress(data) : fallback;
    pickupAddressCache.set(key, address);
    const el = document.getElementById(elId);
    if (el) el.textContent = address;
  } catch {
    const el = document.getElementById(elId);
    if (el) el.textContent = fallback;
  }
}

// --- REAL GPS TRACKING ---
// Keeps the driver's actual current position (used for the dispatch-radius
// filtering below) separate from the simulated en-route animation, which
// only takes over once a ride is accepted (see startDrivingSimulation).
const locationWarningEl = document.getElementById('location-warning');
function showLocationWarning(msg) {
  locationWarningEl.textContent = `📍 ${msg}`;
  locationWarningEl.classList.add('show');
}
function clearLocationWarning() {
  locationWarningEl.classList.remove('show');
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    showLocationWarning("This browser doesn't support location — go online will use a default position.");
    return;
  }
  // The #1 real-world cause of "location never updates": browsers refuse
  // geolocation entirely on plain http:// (except localhost/127.0.0.1).
  if (window.isSecureContext === false) {
    showLocationWarning('Location needs HTTPS (or localhost) to work — this page is loaded over an insecure connection.');
  }

  const onFix = (pos) => {
    const { latitude, longitude } = pos.coords;
    clearLocationWarning();
    // While actively driving a simulated leg, let that animation own the
    // marker/position instead of a real (stationary) GPS fix fighting it.
    if (activeRideId) return;

    currentDriverLat = latitude;
    currentDriverLng = longitude;
    driverMarker.setLatLng([latitude, longitude]);
    // First fix sets the starting zoom; afterwards keep the map glued to the car.
    if (!hasRealFix) { map.setView([latitude, longitude], 14); hasRealFix = true; }
    else centerOnDriver();

    // Resume looking for new requests once the driver has actually pulled
    // away — at least 200m — from where they just dropped someone off.
    if (awaitingDepartureFrom) {
      const distFromDropoff = calculateDistance(latitude, longitude, awaitingDepartureFrom.lat, awaitingDepartureFrom.lng);
      if (distFromDropoff >= RESUME_SEARCH_DISTANCE_KM) {
        awaitingDepartureFrom = null;
        if (isOnline) startPolling();
      }
    }

    if (isOnline) socket.emit('driver-position', { lat: latitude, lng: longitude });
  };

  const onError = (err) => {
    console.warn('Geolocation error:', err.message);
    if (err.code === err.PERMISSION_DENIED) {
      showLocationWarning('Location permission denied — enable it for this site in your browser settings.');
    } else if (err.code === err.TIMEOUT) {
      showLocationWarning('Still waiting for a GPS fix...');
    } else {
      showLocationWarning("Couldn't get your location.");
    }
  };

  // A one-off fast fix first (watchPosition alone can take a while to report
  // its first result on some devices/browsers), then keep it updated live.
  navigator.geolocation.getCurrentPosition(onFix, onError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
  navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}
startLocationWatch();

// --- NAVIGATION SYSTEM ---
function switchPage(page) {
  navItems.forEach(item => item.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  
  if (page === 'home') {
    pageContainer.classList.remove('open');
    return;
  }
  
  pageContainer.classList.add('open');
  pageTitle.textContent = page.charAt(0).toUpperCase() + page.slice(1);
  pageContent.innerHTML = `<div style="color:#666; text-align:center; padding:40px;">Loading ${page}...</div>`;
  
  if (page === 'earn') renderEarnPage();
  if (page === 'rides') renderRidesPage();
  if (page === 'help') renderHelpPage();
}

navItems.forEach(item => {
  item.addEventListener('click', () => switchPage(item.dataset.page));
});

// --- PAGE RENDERERS ---
async function renderEarnPage() {
  pageContent.innerHTML = `
    <div class="page-card">
      <div class="title">💳 How do you want to be paid?</div>
      <div class="sub">Your earnings are paid out to your chosen method. The app keeps a 10% commission.</div>
      <div class="payout-options">
        <button type="button" class="payout-option ${payoutMethod === 'card' ? 'active' : ''}" data-payout="card">💳 Card</button>
        <button type="button" class="payout-option ${payoutMethod === 'voucher' ? 'active' : ''}" data-payout="voucher">🎟️ Voucher</button>
      </div>
      <div class="commission-note">Commission: 10% · You keep 90% of each fare</div>
    </div>
    <div class="page-card">
      <div class="title">💰 Cash out</div>
      <div class="sub" id="available-earnings">Loading available earnings...</div>
      <button type="button" class="cashout-btn" id="cashout-btn" disabled>Cash out</button>
      <div class="commission-note" id="cashout-msg"></div>
    </div>
    <div class="page-card">
      <div class="title">📜 Cash out history</div>
      <div id="cashout-history"><div style="color:#888;">Loading...</div></div>
    </div>
    <div class="page-card"><div class="row"><div><div class="title">Earn more</div><div class="sub">Refer a friend</div></div><span class="amount">R800</span></div></div>
    <div class="page-card"><div class="row"><div><div class="title">Save on essentials</div><div class="sub">Driver discounts</div></div><span class="amount">➜</span></div></div>
  `;

  pageContent.querySelectorAll('.payout-option').forEach(btn => {
    btn.addEventListener('click', () => {
      setPayoutMethod(btn.dataset.payout);
      renderEarnPage();
      updateEarnings();
    });
  });

  await loadCashouts();
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    const gross = rides.filter(r => r.status === 'completed').reduce((s, r) => s + parseFloat(r.cost || 0), 0);
    const net = netOfCommission(gross);
    const available = Math.max(0, net - totalCashedOut());

    const availEl = document.getElementById('available-earnings');
    availEl.textContent = `Available to cash out: R${available.toFixed(2)} (net after 10% commission)`;

    const btn = document.getElementById('cashout-btn');
    btn.disabled = available <= 0;
    btn.textContent = available > 0 ? `Cash out R${available.toFixed(2)} to ${CASHOUT_METHOD_LABEL[payoutMethod] || payoutMethod}` : 'Nothing to cash out';
    btn.addEventListener('click', async () => {
      if (available <= 0) return;
      const msgEl = document.getElementById('cashout-msg');
      msgEl.textContent = 'Processing...';
      try {
        const r = await fetch('/api/cashouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, amount: available, method: payoutMethod })
        });
        const d = await r.json();
        if (!r.ok) { msgEl.textContent = d.error || 'Cash-out failed.'; return; }
        msgEl.textContent = `✅ Cashed out R${d.amount.toFixed(2)} to ${CASHOUT_METHOD_LABEL[d.method] || d.method}.`;
        renderEarnPage(); // refresh available + history
      } catch { msgEl.textContent = 'Cash-out failed.'; }
    });

    renderCashoutHistory();
  } catch {
    const availEl = document.getElementById('available-earnings');
    availEl.textContent = 'Could not load earnings.';
  }
}

async function renderRidesPage() {
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    const completed = rides.filter(r => r.status === 'completed');
    
    let html = '';
    completed.forEach(r => {
      const date = new Date(r.createdAt).toLocaleDateString();
      const typeLabel = RIDE_TYPE_LABELS[r.rideType] || '🚗 Trip';
      const from = r.pickupAddress || `${r.pickup.lat.toFixed(4)}, ${r.pickup.lng.toFixed(4)}`;
      const to = r.dropoffAddress || `${r.dropoff.lat.toFixed(4)}, ${r.dropoff.lng.toFixed(4)}`;
      html += `
        <div class="history-item">
          <div class="info">
            <h4>${typeLabel} · ${date}</h4>
            <p>📍 ${from}</p>
            <p>🏁 ${to}</p>
          </div>
          <div class="price">R${r.cost || '0.00'}<div style="font-size:0.7rem; color:#888;">−10% → R${netOfCommission(r.cost).toFixed(2)}</div></div>
        </div>
      `;
    });
    if (!html) html = '<div style="color:#666;text-align:center;">No ride history yet.</div>';
    pageContent.innerHTML = html;
  } catch { pageContent.innerHTML = '<div style="color:#ff6b6b;">Error loading history.</div>'; }
}

function renderHelpPage() {
  pageContent.innerHTML = `
    <div class="page-card"><div class="title">📧 Send us a message</div></div>
    <div class="page-card"><div class="title">💬 Messages</div></div>
    <div class="page-card"><div class="title">🔍 Browse help articles</div></div>
  `;
}

// --- ONLINE BUTTON ---
// Continuous polling: while online, keep re-fetching pending requests as a
// refresh/fallback alongside the live 'new-ride' socket push. Stops the
// instant a ride is accepted, and only resumes once the driver is back to
// being genuinely available (see resumePollingIfDeparted below).
let pollIntervalId = null;
const POLL_INTERVAL_MS = 8000;
const RESUME_SEARCH_DISTANCE_KM = 0.2; // "200m away from dropoff"
let awaitingDepartureFrom = null; // dropoff coords of the ride just completed, until we've moved off

function startPolling() {
  if (pollIntervalId) return;
  loadPendingRides();
  pollIntervalId = setInterval(loadPendingRides, POLL_INTERVAL_MS);
}
function stopPolling() {
  clearInterval(pollIntervalId);
  pollIntervalId = null;
}

goOnlineBtn.addEventListener('click', () => {
  isOnline = !isOnline;
  if (isOnline) {
    goOnlineBtn.textContent = 'Go offline';
    goOnlineBtn.classList.remove('offline');
    socket.emit('driver-online', { lat: currentDriverLat, lng: currentDriverLng, radiusKm: requestRadiusKm, vehicleCategory: myVehicleCategory });
    centerOnDriver(); // snap the map onto the driver when going online
    startPolling(); // only fetch/show ride requests once actually online
  } else {
    goOnlineBtn.textContent = 'Go online';
    goOnlineBtn.classList.add('offline');
    socket.emit('driver-offline');
    stopPolling();
    awaitingDepartureFrom = null;
    hideRequestSheet();
    closeCodeModal();
    clearDriverWaitingTimer();
    currentArrivedAt = null;
    document.getElementById('route-panel').style.display = 'none';
    if (activeRideId) { socket.emit('driver-cancel-ride', { rideId: activeRideId }); activeRideId = null; activeRideDropoff = null; }

    // Fresh slate for next time this driver comes online.
    Object.keys(rideTimers).forEach(clearRideTimer);
    ignoredRideIds.clear();
    driverRides.innerHTML = '';
  }
});

// --- RIDE REQUEST TIMERS (driver-side only; doesn't touch ride status) ---
function clearRideTimer(id) {
  const t = rideTimers[id];
  if (t) { clearTimeout(t.timeoutId); clearInterval(t.intervalId); delete rideTimers[id]; }
}

function removeRideCard(id) {
  clearRideTimer(id);
  const el = document.getElementById(`ride-${id}`);
  if (el) el.remove();
  if (driverRides.children.length === 0) hideRequestSheet();
}

// Declining (manually, or automatically once the 40s timer runs out) only
// hides the request for THIS driver — the ride stays 'pending' server-side
// so every other driver can still see and accept it.
function declineRide(id) {
  ignoredRideIds.add(id);
  removeRideCard(id);
}

// --- RIDE CARDS ---
function renderRideCard(ride) {
  if (ignoredRideIds.has(ride._id)) return null; // this driver already declined/ignored it

  const card = document.createElement('div');
  card.className = 'ride-card';
  card.id = `ride-${ride._id}`;
  card.style.cssText = 'background:#1a1a2e; padding:12px; border-radius:12px; margin-bottom:8px;';

  const pickupElId = `pickup-addr-${ride._id}`;
  const riderNameElId = `rider-name-${ride._id}`;

  // Rider name + car type + Chat / Payment-info buttons, shown once the ride
  // is accepted (through start/complete), inside this scrollable card.
  const inTrip = ride.status === 'accepted' || ride.status === 'arrived' || ride.status === 'in_progress';
  const riderBlock = inTrip ? `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:10px; border-top:1px solid #2a2a4e;">
      <div style="min-width:0;">
        <div id="${riderNameElId}" style="font-weight:600; font-size:0.9rem;">${ride._id === activeRideId ? currentRiderName : 'Rider'}</div>
        <div style="font-size:0.75rem; color:#888;">${RIDE_TYPE_LABELS[ride.rideType] || '🚗 Standard'}</div>
      </div>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        <button type="button" class="payment-btn" onclick="openPaymentInfo('${ride.paymentMethod || 'cash'}')">${PAYMENT_LABELS[ride.paymentMethod] || PAYMENT_LABELS.cash}</button>
        <button type="button" class="call-btn-small" onclick="startCall()">📞</button>
        <button type="button" class="chat-btn" onclick="openRiderChat()">💬 Chat</button>
      </div>
    </div>
  ` : '';

  // Live waiting-fee line (after "Arrived at pickup" until the ride starts).
  const waitingInfo = (ride.status === 'arrived' || ride.status === 'in_progress') ? `
    <div id="waiting-info" style="text-align:center; color:#f5a623; font-size:0.85rem; font-weight:600; margin-top:8px;">
      ${ride.status === 'in_progress' && ride.waitingFee > 0 ? `💰 Waiting fee: +R${ride.waitingFee.toFixed(2)}` : '⏱ Passenger boarding — free wait 120s'}
    </div>
  ` : '';

  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="font-size:0.85rem; color:#ccc; min-width:0; flex:1;">
        <div><strong>Pickup:</strong> <span id="${pickupElId}">${ride.pickupAddress || 'Locating address...'}</span></div>
        <div style="color:#888; margin-top:2px; word-break:break-word;"><strong>Dropoff:</strong> ${ride.dropoffAddress || 'Locating...'}</div>
      </div>
      ${ride.status === 'pending' ? `<span class="ride-timer" id="ride-timer-${ride._id}">⏱ 40s</span>` : ''}
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
      <span class="status ${ride.status}" style="padding:2px 8px; border-radius:10px; font-size:0.7rem;">${ride.status.replace('_', ' ')}</span>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
        ${ride.status === 'pending' ? `<button class="decline-btn" onclick="declineRide('${ride._id}')" style="background:transparent; color:#ff6b6b; border:1px solid #ff6b6b; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">Decline</button>` : ''}
        ${ride.status === 'pending' ? `<button class="accept-btn" onclick="updateRide('${ride._id}', 'accepted')" style="background:#00d4aa; color:#0d0d1a; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">Accept</button>` : ''}
        ${ride.status === 'accepted' ? `<button class="arrive-btn" onclick="updateRide('${ride._id}', 'arrived')" style="background:#6c63ff; color:#fff; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">📍 Arrived at pickup</button>` : ''}
        ${ride.status === 'arrived' ? `<button class="start-btn" onclick="openStartRideCode('${ride._id}')" style="background:#00d4aa; color:#0d0d1a; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">🚀 Start ride</button>` : ''}
        ${ride.status === 'in_progress' ? `<button class="complete-btn" onclick="updateRide('${ride._id}', 'completed')" style="background:#6c63ff; color:#fff; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">Complete ride</button>` : ''}
      </div>
    </div>
    ${waitingInfo}
    ${riderBlock}
  `;

  resolvePickupAddress(ride, pickupElId);

  if (ride.status === 'pending') {
    clearRideTimer(ride._id); // avoid stacking timers if a card gets re-rendered
    let remaining = 40;
    const intervalId = setInterval(() => {
      remaining -= 1;
      const label = document.getElementById(`ride-timer-${ride._id}`);
      if (label) label.textContent = `⏱ ${remaining}s`;
      if (remaining <= 0) clearInterval(intervalId);
    }, 1000);
    const timeoutId = setTimeout(() => declineRide(ride._id), RIDE_REQUEST_TIMEOUT_MS);
    rideTimers[ride._id] = { timeoutId, intervalId };
  }

  return card;
}

async function loadPendingRides() {
  if (!isOnline) return; // ride requests are only fetched/shown while online
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    let active = rides.filter(r => r.status !== 'completed' && !ignoredRideIds.has(r._id));

    // Mirror the server's dispatch-radius filter for this direct fetch path
    // (e.g. right after going online), so far-away pending requests never show.
    if (hasRealFix) {
      active = active.filter(r => r.status !== 'pending'
        || calculateDistance(currentDriverLat, currentDriverLng, r.pickup.lat, r.pickup.lng) <= requestRadiusKm);
    }

    // Mirror the server's vehicle-category matching too — a sedan driver
    // shouldn't see Bike requests, etc. ('saver' isn't a vehicle type, so
    // it's open to any category.)
    if (myVehicleCategory) {
      active = active.filter(r => r.status !== 'pending' || r.rideType === 'saver' || r.rideType === myVehicleCategory);
    }

    if (active.length === 0) {
      hideRequestSheet();
      return;
    }
    showRequestSheet();
    driverRides.innerHTML = '';
    active.forEach(ride => {
      const card = renderRideCard(ride);
      if (card) driverRides.appendChild(card);
    });
  } catch (err) { console.error('Error loading rides:', err); }
}

// --- DRAW LIVE ROUTE FROM DRIVER'S CURRENT POSITION TO A TARGET ---
function drawRouteToTarget(targetLat, targetLng) {
  fetch(`https://router.project-osrm.org/route/v1/driving/${currentDriverLng},${currentDriverLat};${targetLng},${targetLat}?overview=full&geometries=geojson`)
    .then(res => res.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        document.getElementById('route-distance').textContent = (route.distance / 1000).toFixed(1) + ' km';
        document.getElementById('route-time').textContent = Math.round(route.duration / 60) + ' min';
        if (routeLine) map.removeLayer(routeLine);
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        routeLine = L.polyline(coords, { color: '#00d4aa', weight: 4 }).addTo(map);
        // Keep the map focused on the driver (not zoomed out to fit the whole
        // route) — the car stays centered and the line trails around it.
        centerOnDriver();
      }
    })
    .catch(err => console.warn('Could not draw route:', err));
}

// --- DRAW REFERENCE ROUTE: FULL PICKUP -> DROPOFF PATH FOR THE TRIP ---
function drawTripRoute(pickup, dropoff) {
  fetch(`https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`)
    .then(res => res.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        if (tripRouteLine) map.removeLayer(tripRouteLine);
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        tripRouteLine = L.polyline(coords, { color: '#6c63ff', weight: 3, dashArray: '6 8' }).addTo(map);
      }
    })
    .catch(err => console.warn('Could not draw trip route:', err));
}

// --- UPDATE RIDE ---
async function updateRide(id, status, confirmationCode) {
  try {
    // The driver performing the action always identifies themselves — the
    // server checks ride.driverId against this for arrived/in_progress.
    const body = { status, driverId };
    if (status === 'in_progress') body.confirmationCode = confirmationCode;
    const res = await fetch(`/api/rides/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      if (status === 'in_progress') { showCodeError(data.error || 'Invalid confirmation code.'); return; }
      console.error('Ride update failed:', data.error);
      return;
    }
    clearRideTimer(id); // this driver acted on it — stop its 40s countdown

    if (status === 'accepted' && isOnline) {
      activeRideId = id;
      stopPolling(); // "keep refreshing... until the driver accepts the request, then it stops"
      const ride = data;
      activeRideDropoff = ride.dropoff;
      currentRideCost = Number(ride.cost) || 0;
      document.getElementById('route-panel').style.display = 'block';
      showRiderInfo(ride);

      if (pickupMarker) map.removeLayer(pickupMarker);
      pickupMarker = L.marker([ride.pickup.lat, ride.pickup.lng], { icon: pickupIcon }).addTo(map).bindPopup('Pickup').openPopup();

      if (dropoffMarkerDriver) map.removeLayer(dropoffMarkerDriver);
      dropoffMarkerDriver = L.marker([ride.dropoff.lat, ride.dropoff.lng], { icon: dropoffIcon }).addTo(map).bindPopup('Drop-off');

      // Reference route (pickup -> dropoff) + live route (driver -> pickup).
      drawTripRoute(ride.pickup, ride.dropoff);
      drawRouteToTarget(ride.pickup.lat, ride.pickup.lng);

      // Leg 1: drive to pickup. On arrival the driver must click
      // "Arrived at pickup" — the car does NOT auto-continue or auto-arrive.
      startDrivingSimulation(ride.pickup.lat, ride.pickup.lng, id, () => {
        reportPosition(currentDriverLat, currentDriverLng, id, false); // now stationary
        if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
        const card = document.getElementById(`ride-${id}`);
        if (card) card.replaceWith(renderRideCard(data)); // reveal "Arrived at pickup"
      });
    } else if (status === 'arrived') {
      // Server stamped arrivedAt — the 2-minute free wait window begins.
      currentArrivedAt = data.arrivedAt;
      startDriverWaitingTimer();
      const card = document.getElementById(`ride-${id}`);
      if (card) card.replaceWith(renderRideCard(data)); // reveal "Start ride"
    } else if (status === 'in_progress') {
      closeCodeModal();
      clearDriverWaitingTimer();
      currentArrivedAt = null;
      const feeEl = document.getElementById('waiting-info');
      if (feeEl) feeEl.textContent = data.waitingFee > 0 ? `💰 Waiting fee: +R${data.waitingFee.toFixed(2)}` : '';
      // Leg 2: drive from pickup to drop-off.
      if (activeRideDropoff) {
        drawRouteToTarget(activeRideDropoff.lat, activeRideDropoff.lng);
        startDrivingSimulation(activeRideDropoff.lat, activeRideDropoff.lng, id, () => {
          socket.emit('driver-reached-dropoff', { rideId: id });
          reportPosition(currentDriverLat, currentDriverLng, id, false); // arrived at dropoff
          const card = document.getElementById(`ride-${id}`);
          if (card) card.replaceWith(renderRideCard(data)); // reveal "Complete ride"
        });
      }
    }
    // 'completed' is cleaned up by the shared 'ride-updated' socket handler.
  } catch (err) { console.error('Error updating ride:', err); }
}

// --- START-RIDE CONFIRMATION CODE ---
function openStartRideCode(rideId) {
  pendingStartRideId = rideId;
  codeError.textContent = '';
  codeInput.value = '';
  codeModal.classList.remove('hidden');
  codeInput.focus();
}
function closeCodeModal() {
  pendingStartRideId = null;
  codeModal.classList.add('hidden');
}
function showCodeError(msg) {
  if (codeError) codeError.textContent = msg;
}
codeCancel.addEventListener('click', closeCodeModal);
codeConfirm.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (!pendingStartRideId) return;
  if (!/^\d{4}$/.test(code)) { showCodeError('Enter the 4-digit code from the passenger.'); return; }
  updateRide(pendingStartRideId, 'in_progress', code);
});
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeConfirm.click(); });

// --- RIDER INFO + CHAT ---
// Fetches the rider's name and patches it into the ride card once resolved
// (the card itself already renders immediately with a "Rider" placeholder).
// Also joins the socket room used for chat.
async function showRiderInfo(ride) {
  currentRiderId = ride.riderId;
  currentRiderName = 'Rider';

  if (currentRiderId) {
    try {
      const res = await fetch(`/api/auth/user/${currentRiderId}`);
      if (res.ok) {
        const info = await res.json();
        currentRiderName = info.name || 'Rider';
        const el = document.getElementById(`rider-name-${ride._id}`);
        if (el) el.textContent = currentRiderName;
      }
    } catch { /* keep the "Rider" fallback label */ }
  }

  socket.emit('join-ride-room', activeRideId);
}

function renderChatMessage(msg) {
  const div = document.createElement('div');
  div.className = msg.senderId === driverId ? 'me' : 'them';
  div.textContent = msg.message;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Opens the chat sheet for the current rider — called from the Chat button
// baked into the accepted ride card (see renderRideCard).
async function openRiderChat() {
  chatWithName.textContent = `💬 ${currentRiderName}`;
  chatMessages.innerHTML = '';
  chatSheet.open();
  if (!activeRideId) return;
  try {
    const res = await fetch(`/api/messages/${activeRideId}`);
    const history = await res.json();
    history.forEach(renderChatMessage);
  } catch (err) { console.error('Error loading chat history:', err); }
}
closeChat.addEventListener('click', () => chatSheet.close());

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !activeRideId) return;
  socket.emit('send-message', {
    rideId: activeRideId,
    senderId: driverId,
    senderName: driverName,
    message: text
  });
  chatInput.value = '';
}
chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

socket.on('new-message', (msg) => {
  if (!activeRideId || String(msg.rideId) !== String(activeRideId)) return;
  renderChatMessage(msg);
});

// --- IN-APP CALL (signaling only — rings, accepts/declines, tracks call
// duration; there's no real audio pipeline here, same "simulated but honest"
// approach this app already uses for driver movement/ETA). ---
const callOverlay = document.getElementById('call-overlay');
const callAvatar = document.getElementById('call-avatar');
const callNameEl = document.getElementById('call-name');
const callStatusEl = document.getElementById('call-status');
const callActionsEl = document.getElementById('call-actions');
let callTimerInterval = null;

function callActionBtn(cls, icon, onClick) {
  const btn = document.createElement('button');
  btn.className = `call-action-btn ${cls}`;
  btn.textContent = icon;
  btn.addEventListener('click', onClick);
  return btn;
}

function showOutgoingCall(name) {
  callAvatar.textContent = '📞';
  callNameEl.textContent = name;
  callStatusEl.textContent = 'Ringing...';
  callActionsEl.innerHTML = '';
  callActionsEl.appendChild(callActionBtn('end', '✕', endCall));
  callOverlay.classList.remove('hidden');
}
function showIncomingCall(name) {
  callAvatar.textContent = '📞';
  callNameEl.textContent = name;
  callStatusEl.textContent = 'Incoming call...';
  callActionsEl.innerHTML = '';
  callActionsEl.appendChild(callActionBtn('decline', '✕', declineCall));
  callActionsEl.appendChild(callActionBtn('accept', '📞', acceptCall));
  callOverlay.classList.remove('hidden');
}
function showActiveCall(name) {
  callStatusEl.textContent = '00:00';
  callActionsEl.innerHTML = '';
  callActionsEl.appendChild(callActionBtn('end', '✕', endCall));
  let seconds = 0;
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    callStatusEl.textContent = `${m}:${s}`;
  }, 1000);
}
function hideCallOverlay() {
  clearInterval(callTimerInterval);
  callTimerInterval = null;
  callOverlay.classList.add('hidden');
}

function startCall() {
  if (!activeRideId) return;
  socket.emit('call-request', { rideId: activeRideId, callerName: driverName });
  showOutgoingCall(currentRiderName);
}
function acceptCall() {
  socket.emit('call-accept', { rideId: activeRideId });
  showActiveCall(currentRiderName);
}
function declineCall() {
  socket.emit('call-decline', { rideId: activeRideId });
  hideCallOverlay();
}
function endCall() {
  socket.emit('call-end', { rideId: activeRideId });
  hideCallOverlay();
}

socket.on('incoming-call', (data) => {
  if (!activeRideId || String(data.rideId) !== String(activeRideId)) return;
  showIncomingCall(data.callerName || 'Rider');
});
socket.on('call-accepted', (data) => {
  if (!activeRideId || String(data.rideId) !== String(activeRideId)) return;
  showActiveCall(currentRiderName);
});
socket.on('call-declined', (data) => {
  if (!activeRideId || String(data.rideId) !== String(activeRideId)) return;
  callStatusEl.textContent = 'Call declined';
  setTimeout(hideCallOverlay, 1200);
});
socket.on('call-ended', (data) => {
  if (!activeRideId || String(data.rideId) !== String(activeRideId)) return;
  hideCallOverlay();
});

// --- DRIVING SIMULATION (SMOOTH CAR MOVEMENT) ---
function startDrivingSimulation(targetLat, targetLng, rideId, onArrive) {
  if (moveInterval) clearInterval(moveInterval);
  const steps = 100; let step = 0;
  const dLat = (targetLat - currentDriverLat) / steps;
  const dLng = (targetLng - currentDriverLng) / steps;
  moveInterval = setInterval(() => {
    step++;
    currentDriverLat += dLat; currentDriverLng += dLng;
    driverMarker.setLatLng([currentDriverLat, currentDriverLng]);
    centerOnDriver(); // follow the car while it drives

    // Broadcast to rider in real time (with moving/stationary detection)
    reportPosition(currentDriverLat, currentDriverLng, rideId);

    // Live-update the ETA panel every tick using a fast straight-line estimate
    // (2 min/km) rather than re-querying OSRM 10x/sec, which would hammer the
    // public routing server. The initial drawRouteToTarget() call already gave
    // an accurate road-based figure to start from.
    const remainingKm = calculateDistance(currentDriverLat, currentDriverLng, targetLat, targetLng);
    document.getElementById('route-distance').textContent = remainingKm.toFixed(1) + ' km';
    document.getElementById('route-time').textContent = Math.max(1, Math.round(remainingKm * 2)) + ' min';

    if (step >= steps) {
      clearInterval(moveInterval);
      moveInterval = null;
      if (onArrive) onArrive();
    }
  }, 100);
}

// --- SOCKET EVENTS ---
socket.on('new-ride', (ride) => {
  if (!isOnline) return; // only receive ride requests while online
  if (activeRideId) return; // already on a trip — not taking new requests
  if (ignoredRideIds.has(ride._id)) return;
  // Extra client-side safety net on top of the server's own radius filter.
  if (hasRealFix && calculateDistance(currentDriverLat, currentDriverLng, ride.pickup.lat, ride.pickup.lng) > requestRadiusKm) return;
  // Extra client-side safety net on top of the server's own vehicle-category matching.
  if (myVehicleCategory && ride.rideType !== 'saver' && ride.rideType !== myVehicleCategory) return;

  const noRidesMsg = driverRides.querySelector('.no-rides');
  if (noRidesMsg) noRidesMsg.remove();
  const card = renderRideCard(ride);
  if (card) {
    driverRides.prepend(card);
    showRequestSheet();
  }
});

socket.on('ride-updated', (ride) => {
  const existingCard = document.getElementById(`ride-${ride._id}`);

  // Another driver accepted it first — it's no longer relevant to us.
  if (ride.status === 'accepted' && ride.driverId !== driverId) {
    removeRideCard(ride._id);
    return;
  }

  clearRideTimer(ride._id); // no longer pending (or it's ours now) — countdown no longer applies
  if (existingCard) {
    const newCard = renderRideCard(ride);
    if (newCard) existingCard.replaceWith(newCard);
    else existingCard.remove();
  }

  // Keep the waiting-fee timer in sync if a status change arrives via socket.
  if (ride.status === 'arrived' && String(ride.driverId) === String(driverId)) {
    currentArrivedAt = ride.arrivedAt;
    startDriverWaitingTimer();
  } else if (ride.status === 'in_progress' && String(ride.driverId) === String(driverId)) {
    clearDriverWaitingTimer();
    currentArrivedAt = null;
  }

  if (ride.status === 'completed' && String(ride.driverId) === String(driverId)) {
    document.getElementById('route-panel').style.display = 'none';
    clearDriverWaitingTimer();
    currentArrivedAt = null;
    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (dropoffMarkerDriver) { map.removeLayer(dropoffMarkerDriver); dropoffMarkerDriver = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (tripRouteLine) { map.removeLayer(tripRouteLine); tripRouteLine = null; }
    if (moveInterval) { clearInterval(moveInterval); moveInterval = null; }

    // Don't resume looking for new requests until the driver has actually
    // pulled away from this dropoff — see resumePollingIfDeparted() below,
    // called from the GPS watch as the driver's real position updates.
    awaitingDepartureFrom = activeRideDropoff || ride.dropoff || null;

    activeRideId = null;
    activeRideDropoff = null;
    currentRiderId = null;
    currentRiderName = 'Rider';
    chatSheet.close();
    chatMessages.innerHTML = '';
    paymentSheet.close();
    hideCallOverlay();
    updateEarnings();
  }
});

// --- TOGGLES ---
menuBtn.addEventListener('click', () => { sideMenu.classList.add('open'); sideOverlay.classList.add('open'); });
sideOverlay.addEventListener('click', () => { sideMenu.classList.remove('open'); sideOverlay.classList.remove('open'); });
logoutMenuItem.addEventListener('click', () => { localStorage.clear(); window.location.href = 'login.html'; });

safetyBtn.addEventListener('click', () => safetyModal.classList.add('open'));
safetyClose.addEventListener('click', () => safetyModal.classList.remove('open'));

// --- EARNINGS ---
async function updateEarnings() {
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    const total = rides.filter(r => r.status === 'completed').reduce((sum, r) => sum + parseFloat(r.cost || 0), 0);
    const net = netOfCommission(total); // the driver keeps 90% after the 10% commission
    document.getElementById('total-earnings').textContent = `R${net.toFixed(2)}`;
  } catch { }
}
updateEarnings();
// NOTE: loadPendingRides() is intentionally NOT called here — ride requests
// should only be fetched/shown once the driver actually goes online (see the
// goOnlineBtn handler above).