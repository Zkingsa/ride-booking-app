document.addEventListener('DOMContentLoaded', () => {
  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName');
  const userEmail = localStorage.getItem('userEmail');

  if (!userId) {
    alert('Please login first!');
    window.location.href = 'login.html';
    return;
  }

  // --- SOCKET (for live driver tracking) ---
  const socket = io();

  // --- PROFILE DATA ---
  document.getElementById('profile-name').textContent = userName || 'Rider';
  document.getElementById('profile-email').textContent = userEmail || 'No email';
  document.getElementById('profile-id').textContent = userId;

  // --- DOM ELEMENTS ---
  const homeScreen = document.getElementById('home-screen');
  const mapScreen = document.getElementById('map-screen');
  const pageContainer = document.getElementById('page-container');
  const navItems = document.querySelectorAll('.nav-item');
  const pickupSearch = document.getElementById('pickup-search');
  const dropoffSearch = document.getElementById('dropoff-search');
  const openMapBtn = document.getElementById('open-map-btn');
  const closeMapBtn = document.getElementById('close-map-btn');
  const pickupPinBtn = document.getElementById('pickup-pin-btn');
  const dropoffPinBtn = document.getElementById('dropoff-pin-btn');
  const confirmBtn = document.getElementById('confirm-ride-btn');
  const routeInfoText = document.getElementById('route-info-text');
  const rideOptionsList = document.getElementById('ride-options-list');
  
  const profileBtn = document.getElementById('profile-btn');
  const profileModal = document.getElementById('profile-modal');
  const closeProfile = document.getElementById('close-profile');
  const logoutBtn = document.getElementById('logout-btn');

  // --- LIVE TRACKING DOM ELEMENTS ---
  const trackingPanel = document.getElementById('tracking-panel');
  const trackingStatus = document.getElementById('tracking-status');
  const trackingEta = document.getElementById('tracking-eta');
  const trackingMotion = document.getElementById('tracking-motion');
  const trackingWait = document.getElementById('tracking-wait');
  const trackingCode = document.getElementById('tracking-code');
  const driverInfoCard = document.getElementById('driver-info-card');
  const driverInfoName = document.getElementById('driver-info-name');
  const driverInfoVehicle = document.getElementById('driver-info-vehicle');
  const openChatBtn = document.getElementById('open-chat-btn');
  const openCallBtn = document.getElementById('open-call-btn');

  // --- CONFIRMATION CODE MODAL (rider sets a 4-digit code at booking) ---
  const codeModal = document.getElementById('code-modal');
  const codeInput = document.getElementById('code-input');
  const codeError = document.getElementById('code-error');
  const codeCancel = document.getElementById('code-cancel');
  const codeConfirm = document.getElementById('code-confirm');

  // --- CHAT DOM ELEMENTS ---
  const chatModal = document.getElementById('chat-modal');
  const chatHandle = document.getElementById('chat-handle');
  const chatWithName = document.getElementById('chat-with-name');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const closeChat = document.getElementById('close-chat');
  let currentDriverId = null;
  let currentDriverName = 'Driver';

  // --- PAYMENT METHOD DOM ELEMENTS ---
  const paymentModal = document.getElementById('payment-modal');
  const paymentHandle = document.getElementById('payment-handle');
  const paymentPillBtn = document.getElementById('payment-pill-btn');
  const paymentOptionsEl = document.getElementById('payment-options');
  const closePayment = document.getElementById('close-payment');
  const PAYMENT_LABELS = { cash: '💵 Cash', card: '💳 Card' };
  // Saved cards keep only masked display details (brand, last 4, expiry, name)
  // — never the full number or CVV. The pill reflects the last chosen method.
  let savedCards = [];
  try { savedCards = JSON.parse(localStorage.getItem('savedCards') || '[]'); } catch { savedCards = []; }
  let selectedPaymentMethod = (localStorage.getItem('paymentMethod') === 'card' && savedCards.length) ? 'card' : 'cash';

  function persistCards() { localStorage.setItem('savedCards', JSON.stringify(savedCards)); }
  function cardShort(c) { return `${c.brand} •••• ${c.last4}`; }
  function paymentPillLabel() {
    return (selectedPaymentMethod === 'card' && savedCards.length) ? `💳 ${cardShort(savedCards[0])}` : PAYMENT_LABELS.cash;
  }
  paymentPillBtn.textContent = paymentPillLabel();

  // --- DRAGGABLE BOTTOM SHEET (used by chat + payment method) ---
  // Height-driven, not transform-driven, so it plays nicely with the sheet's
  // own internal scrolling (chat history / payment list). Drag the handle up
  // or down between minVH/maxVH; dragging below ~60% of minVH closes it.
  function makeDragSheet(sheetEl, handleEl, { minVH = 32, maxVH = 88, startVH = 55 } = {}) {
    const appEl = sheetEl.parentElement;
    let dragging = false, startY = 0, startHeightPx = 0;

    function vhToPx(vh) { return (appEl.clientHeight * vh) / 100; }

    function open() {
      sheetEl.classList.remove('hidden');
      sheetEl.style.transition = 'none';
      sheetEl.style.height = `${vhToPx(startVH)}px`;
      // Force layout so the next height change (if any) can transition smoothly.
      void sheetEl.offsetHeight;
      sheetEl.style.transition = '';
    }
    function close() {
      sheetEl.style.transition = 'height 0.2s ease';
      sheetEl.style.height = '0px';
      setTimeout(() => sheetEl.classList.add('hidden'), 200);
    }
    function snapTo(vh) {
      sheetEl.style.transition = 'height 0.2s ease';
      sheetEl.style.height = `${vhToPx(vh)}px`;
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
      if (heightPx < minPx * 0.6) { close(); return; }
      const midPx = vhToPx((minVH + maxVH) / 2);
      const maxPx = vhToPx(maxVH);
      // Snap to whichever of the three stops is closest to where it was dropped.
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
  const paymentSheet = makeDragSheet(paymentModal, paymentHandle, { minVH: 30, maxVH: 70, startVH: 42 });

  // --- LIVE TRACKING STATE ---
  let currentRideId = null;
  let trackingActive = false;
  let driverArrivedAtPickup = false;
  let driverLiveMarker = null;
  let currentRideCode = '';     // the 4-digit code this rider set at booking
  let currentArrivedAt = null;  // when the driver clicked "Arrived at pickup"
  let waitingTimerInterval = null; // rider-side live waiting-fee countdown

  // Waiting-fee mirror of the server's model: 2 min free, then R0.20 / 20s.
  const FREE_WAIT_MS = 2 * 60 * 1000;
  const WAIT_FEE_PERIOD_MS = 20 * 1000;
  const WAIT_FEE_PER_PERIOD = 0.20;

  function clearWaitingTimer() {
    if (waitingTimerInterval) { clearInterval(waitingTimerInterval); waitingTimerInterval = null; }
    if (trackingWait) trackingWait.textContent = '';
  }

  // Live countdown: "free for Xs" until 2 minutes are up, then the fee grows.
  function startWaitingTimer() {
    clearWaitingTimer();
    if (!currentArrivedAt) return;
    waitingTimerInterval = setInterval(() => {
      if (!trackingWait) return;
      const elapsed = Date.now() - new Date(currentArrivedAt).getTime();
      if (elapsed < FREE_WAIT_MS) {
        const left = Math.ceil((FREE_WAIT_MS - elapsed) / 1000);
        trackingWait.textContent = `⏱ Driver waiting — free for ${left}s`;
      } else {
        const chargedMs = elapsed - FREE_WAIT_MS;
        const periods = Math.floor(chargedMs / WAIT_FEE_PERIOD_MS);
        const fee = (periods * WAIT_FEE_PER_PERIOD).toFixed(2);
        trackingWait.textContent = `💰 Waiting fee accruing: +R${fee} (R0.20 / 20s)`;
      }
    }, 1000);
  }

  const driverCarIcon = L.divIcon({
    className: 'driver-car-icon',
    html: '🚗',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  // --- PROFILE TOGGLE ---
  profileBtn.addEventListener('click', () => profileModal.classList.add('open'));
  closeProfile.addEventListener('click', () => profileModal.classList.remove('open'));
  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });

  // --- NAVIGATION ---
  function switchPage(page) {
    navItems.forEach(item => item.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
    homeScreen.style.display = page === 'home' ? 'block' : 'none';
    if (!trackingActive) mapScreen.classList.remove('open');
    pageContainer.style.display = page === 'rides' ? 'block' : 'none';
    if (page === 'rides') loadRides();
  }
  navItems.forEach(item => item.addEventListener('click', () => switchPage(item.dataset.page)));

  // --- HELPER: CALCULATE DISTANCE ---
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

  // --- HELPER: DISAMBIGUATE ADDRESSES ---
  // Nominatim's raw display_name is one long string; the first segment alone
  // ("Greyville") isn't enough to tell Greyville-Durban from Greyville-Gqeberha.
  // Build "Place, Suburb/City, Province" instead.
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

  // --- MAP SETUP ---
  let pickupMarker = null, dropoffMarker = null, routeLine = null;
  let clickState = 'pickup';
  // Holds a GPS fix if it arrives before/while the map initializes (declared
  // here, ahead of initRiderMap(), since that function reads it).
  let pendingGeoLocation = null;

  // When set, the next map tap fills ONLY this field (used by the 📌 buttons
  // on the search inputs) instead of following the normal pickup->dropoff
  // sequence. Cleared once that tap is handled.
  let pinPickField = null;

  // --- RIDE OPTIONS ---
  // priceMult/etaMult scale the base Standard fare/time. Saver is cheaper
  // because it's matched with a driver who's still finishing another trip —
  // hence the longer eta — instead of dispatching the nearest idle car.
  const RIDE_TYPES = [
    { id: 'bike', name: 'Bike', icon: '🏍️', seats: 1, priceMult: 0.55, etaMult: 0.75, sub: 'Fastest through traffic' },
    { id: 'mini', name: 'Mini', icon: '🚙', seats: 2, priceMult: 0.8, etaMult: 0.95, sub: 'Compact, budget car' },
    { id: 'standard', name: 'Standard', icon: '🚗', seats: 4, priceMult: 1, etaMult: 1, sub: 'Everyday rides' },
    { id: 'xl', name: 'XL', icon: '🚐', seats: 8, priceMult: 1.6, etaMult: 1.15, sub: 'Mini bus — bigger groups' },
    { id: 'saver', name: 'Saver', icon: '💸', seats: 4, priceMult: 0.7, etaMult: 1.7, sub: 'Cheapest — matched with a driver finishing a nearby trip' }
  ];
  let selectedRideType = 'standard';
  let currentRideCost = 0;
  let currentBasePrice = 0; // last-computed base fare (before tier multiplier) for the current pickup/dropoff

  const greenIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
  });
  const redIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
  });

  // Places (or moves) the pickup pin and updates shared UI state.
  // Used by map taps, search selection, AND geolocation — one source of truth
  // so "current location" is always a real, bookable pin, not just text.
  function setPickup(latlng) {
    if (pickupMarker) window.riderMap.removeLayer(pickupMarker);
    pickupMarker = L.marker(latlng, { icon: greenIcon }).addTo(window.riderMap).bindPopup('Pickup').openPopup();

    // A pin-drop pick (📌 button) is only meant to set THIS field's address —
    // never trigger a fare/route calc, even if the other pin already exists
    // (finishPinPick() closes back to Home right after this either way).
    if (pinPickField) { clickState = dropoffMarker ? 'done' : 'dropoff'; return; }

    if (dropoffMarker) {
      clickState = 'done';
      updateRouteAndOptions();
    } else {
      clickState = 'dropoff';
      routeInfoText.textContent = '📍 Pickup set — Dropoff?';
      rideOptionsList.innerHTML = `<div style="color:#6b6b8d; text-align:center;">Now tap the map or search for Dropoff</div>`;
    }
  }

  function setDropoff(latlng) {
    if (dropoffMarker) window.riderMap.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(latlng, { icon: redIcon }).addTo(window.riderMap).bindPopup('Dropoff').openPopup();

    if (pinPickField) { clickState = pickupMarker ? 'done' : 'pickup'; return; }

    if (!pickupMarker) {
      // Dropoff was picked (e.g. via the 📌 button) before pickup exists —
      // just drop the pin and prompt for pickup, no fare/route to compute yet.
      clickState = 'pickup';
      routeInfoText.textContent = '🏁 Dropoff set — Pickup?';
      rideOptionsList.innerHTML = `<div style="color:#6b6b8d; text-align:center;">Now tap the map or search for Pickup</div>`;
      return;
    }

    clickState = 'done';
    updateRouteAndOptions();
  }

  // Recomputes the fare/eta for every ride tier and redraws the route once
  // BOTH pins exist. Called from setPickup/setDropoff whenever the other pin
  // is already on the map (covers the normal 2-tap flow, search selection,
  // and re-picking either point individually via the 📌 buttons).
  function updateRouteAndOptions() {
    const pickupLatLng = pickupMarker.getLatLng();
    const dropoffLatLng = dropoffMarker.getLatLng();
    routeInfoText.textContent = `${pickupSearch.value || 'Pickup'} → ${dropoffSearch.value || 'Dropoff'}`;

    const dist = calculateDistance(pickupLatLng.lat, pickupLatLng.lng, dropoffLatLng.lat, dropoffLatLng.lng);
    renderRideOptions(dist);

    // Draw the full pickup → dropoff route (stays visible through the whole trip)
    if (routeLine) window.riderMap.removeLayer(routeLine);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pickupLatLng.lng},${pickupLatLng.lat};${dropoffLatLng.lng},${dropoffLatLng.lat}?overview=full&geometries=geojson`;
    fetch(osrmUrl)
      .then(res => res.json())
      .then(data => {
        if (data.routes && data.routes.length > 0) {
          const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
          routeLine = L.polyline(coords, { color: '#00d4aa', weight: 4 }).addTo(window.riderMap);
          window.riderMap.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
        }
      })
      .catch(err => console.warn('Could not draw route:', err));
  }

  // Renders all ride tiers (Bike/Mini/Standard/Saver) for the given distance,
  // keeping whichever tier is currently selected highlighted. Each row has
  // its own Request button so a ride can be booked directly from that row,
  // without needing to select-then-scroll-to-the-bottom-button.
  function renderRideOptions(dist) {
    const baseTimeEst = Math.max(1, Math.round(dist * 2));
    const basePrice = 15 + (dist * 8);
    currentBasePrice = basePrice;

    rideOptionsList.innerHTML = RIDE_TYPES.map(rt => {
      const price = Math.max(5, basePrice * rt.priceMult);
      const eta = Math.max(1, Math.round(baseTimeEst * rt.etaMult));
      const seatLabel = rt.seats === 1 ? '1 seat' : `${rt.seats} seats`;
      const isSelected = rt.id === selectedRideType;
      const subClass = rt.id === 'saver' ? 'sub saver-sub' : 'sub';
      return `
        <div class="ride-option${isSelected ? ' selected' : ''}" data-ride-type="${rt.id}">
          <div class="car-icon">${rt.icon}</div>
          <div class="details"><div class="name">${rt.name}</div><div class="${subClass}">${eta} min · ${seatLabel} · ${rt.sub}</div></div>
          <div class="right-col">
            <div class="price">R${price.toFixed(0)}</div>
            <button type="button" class="request-row-btn" data-ride-type="${rt.id}">Request</button>
          </div>
        </div>
      `;
    }).join('');

    rideOptionsList.querySelectorAll('.ride-option').forEach(el => {
      el.addEventListener('click', () => {
        selectedRideType = el.dataset.rideType;
        renderRideOptions(dist); // re-render to move the highlight + refresh the bottom button
      });
    });

    // Request buttons book that specific tier immediately, regardless of
    // which row is currently "selected" for highlighting purposes.
    rideOptionsList.querySelectorAll('.request-row-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't also trigger the row's select handler
        requestRide(btn.dataset.rideType);
      });
    });

    updateConfirmButton(basePrice);
  }

  function updateConfirmButton(basePrice) {
    const rt = RIDE_TYPES.find(r => r.id === selectedRideType) || RIDE_TYPES[2];
    currentRideCost = Math.max(5, basePrice * rt.priceMult);
    confirmBtn.textContent = `${rt.icon} Request ${rt.name} (R${currentRideCost.toFixed(0)})`;
  }

  // --- ONLINE DRIVERS (shown on the map + a live "looking for drivers"
  // indicator, refreshed continuously so the rider can always see who's
  // actually around, not just a one-time snapshot). ---
  const onlineDriversBadge = document.getElementById('online-drivers-badge');
  const onlineDriverIcon = L.divIcon({ className: 'driver-car-icon', html: '🚗', iconSize: [26, 26], iconAnchor: [13, 13] });
  let onlineDriverMarkers = null; // Leaflet layer group, created once the map exists
  const ONLINE_DRIVERS_POLL_MS = 5000;

  async function refreshOnlineDrivers() {
    if (!window.riderMap) return;
    if (!onlineDriverMarkers) { onlineDriverMarkers = L.layerGroup().addTo(window.riderMap); }
    try {
      const res = await fetch('/api/drivers/online');
      const drivers = await res.json();
      onlineDriverMarkers.clearLayers();
      drivers.forEach(d => {
        L.marker([d.lat, d.lng], { icon: onlineDriverIcon, opacity: d.busy ? 0.55 : 1 }).addTo(onlineDriverMarkers);
      });
      if (drivers.length > 0) {
        onlineDriversBadge.textContent = `🟢 ${drivers.length} driver${drivers.length === 1 ? '' : 's'} online nearby`;
        onlineDriversBadge.classList.remove('searching');
      } else {
        onlineDriversBadge.textContent = '🔎 Looking for drivers...';
        onlineDriversBadge.classList.add('searching');
      }
    } catch (err) { console.error('Error fetching online drivers:', err); }
  }
  refreshOnlineDrivers();
  setInterval(refreshOnlineDrivers, ONLINE_DRIVERS_POLL_MS);

  function initRiderMap() {
    if (window.riderMap) {
      window.riderMap.invalidateSize();
      return;
    }
    window.riderMap = L.map('rider-map').setView([-29.8587, 31.0218], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.riderMap);

    window.riderMap.on('click', (e) => {
      if (trackingActive) return; // don't let taps move markers mid-trip

      if (pinPickField === 'pickup') {
        setPickup(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng, pickupSearch);
        finishPinPick();
      } else if (pinPickField === 'dropoff') {
        setDropoff(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng, dropoffSearch);
        finishPinPick();
      } else if (clickState === 'pickup') {
        setPickup(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng, pickupSearch);
      } else {
        setDropoff(e.latlng);
        reverseGeocode(e.latlng.lat, e.latlng.lng, dropoffSearch);
      }
    });

    // Map now exists — if we already have a GPS fix waiting, drop the pickup pin now.
    if (pendingGeoLocation) {
      setPickup(pendingGeoLocation.latlng);
      pickupSearch.value = pendingGeoLocation.label;
      window.riderMap.setView(pendingGeoLocation.latlng, 15);
      pendingGeoLocation = null;
    }
  }

  async function reverseGeocode(lat, lng, inputElement) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
      const data = await res.json();
      if (data.display_name) {
        inputElement.value = formatAddress(data);
      }
    } catch { }
  }

  // Initialize the map right away (it's always in the DOM, just invisible
  // until "Find Rides" is opened) so geolocation can drop a real pin on it
  // immediately, instead of only filling in text nobody can act on.
  initRiderMap();

  // --- AUTO DETECT LOCATION ---
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const latlng = L.latLng(lat, lng);

      let label = '📍 Current Location';
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`);
        const data = await res.json();
        if (data.display_name) label = formatAddress(data);
      } catch { /* keep fallback label */ }

      if (window.riderMap) {
        setPickup(latlng);
        pickupSearch.value = label;
        window.riderMap.setView(latlng, 15);
      } else {
        // Map isn't ready yet — initRiderMap() will apply this once it runs.
        pendingGeoLocation = { latlng, label };
      }
    }, () => {
      pickupSearch.value = '📍 Current Location';
    });
  } else {
    pickupSearch.value = '📍 Current Location';
  }

  // --- OPEN / CLOSE MAP ---
  openMapBtn.addEventListener('click', () => {
    pinPickField = null;
    mapScreen.classList.add('open');
    if (window.riderMap) window.riderMap.invalidateSize();

    // A pin-drop pick deliberately doesn't show ride options right away (see
    // setPickup/setDropoff). But pressing "Find Rides" is an explicit request
    // to see them — if both locations are already known (however they were
    // set: typed, searched, or pinned), show the full ride list/price/route
    // immediately, exactly as if both had just been typed in.
    if (pickupMarker && dropoffMarker) {
      updateRouteAndOptions();
    }
  });
  closeMapBtn.addEventListener('click', () => {
    pinPickField = null; // cancel any in-progress single-pin pick
    // During a trip the tracking panel + driver chat/call live on the map
    // screen, so it can't be closed — the rider must be able to see them.
    if (trackingActive) return;
    mapScreen.classList.remove('open');
  });

  // --- 📌 PIN-DROP PICKERS (opens the map for one specific input) ---
  function openPinPicker(field) {
    if (trackingActive) return;
    pinPickField = field;
    if (!window.riderMap) initRiderMap();
    mapScreen.classList.add('open');
    window.riderMap.invalidateSize();
    routeInfoText.textContent = field === 'pickup'
      ? '📍 Tap the map to drop your Pickup pin'
      : '🏁 Tap the map to drop your Dropoff pin';
  }
  pickupPinBtn.addEventListener('click', () => openPinPicker('pickup'));
  dropoffPinBtn.addEventListener('click', () => openPinPicker('dropoff'));

  // A pin-drop pick (via the 📌 buttons) is for editing ONE field only — it
  // should never jump into the ride-options/request view, even if the other
  // field already happened to be set. Always hop back to Home after the tap.
  function finishPinPick() {
    pinPickField = null;
    setTimeout(() => { mapScreen.classList.remove('open'); }, 450);
  }

  // --- REQUEST RIDE ---
  // Shared by the bottom "Request" button (uses whichever tier is selected)
  // and each ride option row's own Request button (books that row directly).
  // The rider must set a 4-digit confirmation code, which the driver will
  // have to enter to START the ride (anti-fraud for card payment).
  let pendingRideData = null;

  async function requestRide(rideTypeId) {
    if (!pickupMarker || !dropoffMarker) {
      alert('Please set both Pickup and Dropoff on the map first.');
      return;
    }

    const p = pickupMarker.getLatLng();
    const d = dropoffMarker.getLatLng();
    const rt = RIDE_TYPES.find(r => r.id === rideTypeId) || RIDE_TYPES[2];
    const cost = Math.max(5, currentBasePrice * rt.priceMult);

    pendingRideData = {
      pickup: { lat: p.lat, lng: p.lng },
      dropoff: { lat: d.lat, lng: d.lng },
      pickupAddress: pickupSearch.value.trim() || 'Pickup',
      dropoffAddress: dropoffSearch.value.trim() || 'Dropoff',
      riderId: userId,
      cost: cost.toFixed(2),
      rideType: rt.id,
      seats: rt.seats,
      paymentMethod: selectedPaymentMethod
    };
    openCodeModal();
  }

  // --- CONFIRMATION CODE MODAL ---
  function openCodeModal() {
    codeError.textContent = '';
    codeInput.value = '';
    codeModal.classList.remove('hidden');
    codeInput.focus();
  }
  function closeCodeModal() {
    codeModal.classList.add('hidden');
  }
  codeCancel.addEventListener('click', () => {
    pendingRideData = null;
    closeCodeModal();
  });
  codeConfirm.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (!/^\d{4}$/.test(code)) {
      codeError.textContent = 'Please enter a 4-digit code.';
      return;
    }
    const rideData = { ...pendingRideData, confirmationCode: code };
    pendingRideData = null;
    closeCodeModal();
    (async () => {
      try {
        const res = await fetch('/api/rides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rideData)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Failed to request ride.');
          return;
        }
        const ride = await res.json();
        startTracking(ride);
      } catch (err) {
        console.error('Error requesting ride:', err);
        alert('Failed to request ride.');
      }
    })();
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeConfirm.click(); });

  confirmBtn.addEventListener('click', () => requestRide(selectedRideType));

  // --- LIVE DRIVER TRACKING ---
  function startTracking(ride) {
    currentRideId = ride._id;
    trackingActive = true;
    driverArrivedAtPickup = false;
    currentRideCode = ride.confirmationCode || '';
    currentArrivedAt = null;

    // The driver status / chat / call live in the map screen's sheet, so the
    // map must stay open for the whole trip or the rider won't see them.
    mapScreen.classList.add('open');
    if (window.riderMap) window.riderMap.invalidateSize();

    rideOptionsList.style.display = 'none';
    confirmBtn.style.display = 'none';
    trackingPanel.classList.remove('hidden');
    trackingStatus.textContent = (ride.rideType === 'saver')
      ? '💸 Saver selected — matching you with a driver finishing a nearby trip...'
      : '🔎 Looking for a nearby driver...';
    trackingEta.textContent = '';
    trackingMotion.textContent = '';
    trackingWait.textContent = '';
    trackingCode.textContent = currentRideCode ? `🔑 Your confirmation code: ${currentRideCode}` : '';
    clearWaitingTimer();
    routeInfoText.textContent = `${ride.pickupAddress || pickupSearch.value || 'Pickup'} → ${ride.dropoffAddress || dropoffSearch.value || 'Dropoff'}`;
    // routeLine (pickup → dropoff) from setDropoff() stays on the map through the whole trip.
  }

  function endTracking() {
    trackingActive = false;
    currentRideId = null;
    driverArrivedAtPickup = false;
    currentRideCode = '';
    currentArrivedAt = null;
    clearWaitingTimer();
    if (driverLiveMarker && window.riderMap) { window.riderMap.removeLayer(driverLiveMarker); driverLiveMarker = null; }
    trackingPanel.classList.add('hidden');
    rideOptionsList.style.display = 'block';
    confirmBtn.style.display = 'block';
    driverInfoCard.classList.add('hidden');
    chatSheet.close();
    chatMessages.innerHTML = '';
    hideCallOverlay();
    currentDriverId = null;
    currentDriverName = 'Driver';
    resetMarkers();
  }

  // Ride status changes (accepted / arrived / started / completed) pushed from the server
  socket.on('ride-updated', (ride) => {
    if (!trackingActive || ride._id !== currentRideId) return;

    if (ride.status === 'accepted') {
      trackingStatus.textContent = '🚗 Your driver is on the way to pick you up';
      trackingMotion.textContent = '';
      showDriverInfo(ride);
    } else if (ride.status === 'arrived') {
      currentArrivedAt = ride.arrivedAt;
      driverArrivedAtPickup = true;
      trackingStatus.textContent = '📍 Your driver has arrived at pickup';
      trackingMotion.textContent = '⏸️ Driver is stationary';
      startWaitingTimer();
    } else if (ride.status === 'in_progress') {
      currentArrivedAt = null;
      clearWaitingTimer();
      trackingStatus.textContent = '🚗 Ride started — heading to your destination';
      trackingWait.textContent = ride.waitingFee > 0 ? `💰 Waiting fee: +R${ride.waitingFee.toFixed(2)}` : '';
    } else if (ride.status === 'completed') {
      trackingStatus.textContent = '✅ Trip completed — thanks for riding!';
      trackingEta.textContent = '';
      clearWaitingTimer();
      setTimeout(() => {
        endTracking();
        mapScreen.classList.remove('open');
        switchPage('rides');
      }, 2500);
    }
  });

  // Fetches the driver's name and shows them + their car type + a Chat button
  // once the ride's been accepted. Also joins the socket room used for chat.
  async function showDriverInfo(ride) {
    currentDriverId = ride.driverId;
    const rt = RIDE_TYPES.find(r => r.id === ride.rideType) || RIDE_TYPES[2];
    driverInfoVehicle.textContent = `${rt.icon} ${rt.name} · ${rt.seats === 1 ? '1 seat' : rt.seats + ' seats'}`;
    driverInfoName.textContent = 'Driver';
    driverInfoCard.classList.remove('hidden');

    if (currentDriverId) {
      try {
        const res = await fetch(`/api/auth/user/${currentDriverId}`);
        if (res.ok) {
          const info = await res.json();
          currentDriverName = info.name || 'Driver';
          driverInfoName.textContent = currentDriverName;
          // Real registered vehicle (make, color, plate) is more useful for
          // spotting the car than just the ride tier icon, when we have it.
          if (info.vehicle) {
            const v = info.vehicle;
            driverInfoVehicle.textContent = `${v.color || ''} ${v.make || ''} · ${v.registration || ''}`.replace(/\s+/g, ' ').trim();
          }
        }
      } catch { /* keep the "Driver" fallback label */ }
    }

    socket.emit('join-ride-room', currentRideId);
  }

  // Live driver GPS position, broadcast every ~100ms while a trip is active.
  // This is what draws "where the car is" and drives the live ETA countdown.
  socket.on('driver-location', (data) => {
    if (!trackingActive || data.rideId !== currentRideId || !window.riderMap) return;

    // Moving/stationary detection (computed driver-side from position deltas).
    trackingMotion.textContent = data.moving === false
      ? '⏸️ Driver is stationary'
      : '🟢 Driver is moving';

    const latlng = L.latLng(data.lat, data.lng);
    if (!driverLiveMarker) {
      driverLiveMarker = L.marker(latlng, { icon: driverCarIcon }).addTo(window.riderMap);
    } else {
      driverLiveMarker.setLatLng(latlng);
    }

    // Keep the driver and the relevant point (pickup, then dropoff) framed in view
    const anchor = (driverArrivedAtPickup && dropoffMarker) ? dropoffMarker : pickupMarker;
    if (anchor) {
      const anchorLatLng = anchor.getLatLng();
      const bounds = L.latLngBounds([latlng, anchorLatLng]);
      window.riderMap.fitBounds(bounds, { padding: [70, 70] });

      // Live "how long it will take" readout. Uses a fast straight-line estimate
      // (2 min/km, matching this app's pricing model) rather than calling OSRM
      // on every tick — 10 requests/sec would hammer the public routing server.
      const remainingKm = calculateDistance(data.lat, data.lng, anchorLatLng.lat, anchorLatLng.lng);
      const etaMin = Math.max(1, Math.round(remainingKm * 2));
      const label = driverArrivedAtPickup ? 'Arriving at destination in' : 'Driver arriving in';
      trackingEta.textContent = `🕒 ${label} ~${etaMin} min (${remainingKm.toFixed(1)} km)`;
    }
  });

  socket.on('driver-arrived', (data) => {
    if (!trackingActive || data.rideId !== currentRideId) return;
    driverArrivedAtPickup = true;
    trackingStatus.textContent = '🎉 Your driver has arrived at pickup!';
  });

  socket.on('driver-reached-dropoff', (data) => {
    if (!trackingActive || data.rideId !== currentRideId) return;
    trackingStatus.textContent = '📍 Arriving at your destination...';
    trackingEta.textContent = '';
  });

  // --- CHAT (rider <-> driver, available once the ride is accepted) ---
  function renderChatMessage(msg) {
    const div = document.createElement('div');
    div.className = msg.senderId === userId ? 'me' : 'them';
    div.textContent = msg.message;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  openChatBtn.addEventListener('click', async () => {
    chatWithName.textContent = `💬 ${currentDriverName}`;
    chatMessages.innerHTML = '';
    chatSheet.open();
    if (!currentRideId) return;
    try {
      const res = await fetch(`/api/messages/${currentRideId}`);
      const history = await res.json();
      history.forEach(renderChatMessage);
    } catch (err) { console.error('Error loading chat history:', err); }
  });
  closeChat.addEventListener('click', () => chatSheet.close());

  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentRideId) return;
    socket.emit('send-message', {
      rideId: currentRideId,
      senderId: userId,
      senderName: userName || 'Rider',
      message: text
    });
    chatInput.value = '';
  }
  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

  socket.on('new-message', (msg) => {
    if (!trackingActive || String(msg.rideId) !== String(currentRideId)) return;
    renderChatMessage(msg);
  });

  // --- IN-APP CALL (signaling only — rings, accepts/declines, tracks call
  // duration; there's no real audio pipeline here, same "simulated but
  // honest" approach this app already uses for driver movement/ETA). ---
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
  function showActiveCall() {
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
    if (!currentRideId) return;
    socket.emit('call-request', { rideId: currentRideId, callerName: userName || 'Rider' });
    showOutgoingCall(currentDriverName);
  }
  function acceptCall() {
    socket.emit('call-accept', { rideId: currentRideId });
    showActiveCall();
  }
  function declineCall() {
    socket.emit('call-decline', { rideId: currentRideId });
    hideCallOverlay();
  }
  function endCall() {
    socket.emit('call-end', { rideId: currentRideId });
    hideCallOverlay();
  }

  openCallBtn.addEventListener('click', startCall);

  socket.on('incoming-call', (data) => {
    if (!trackingActive || String(data.rideId) !== String(currentRideId)) return;
    showIncomingCall(data.callerName || 'Driver');
  });
  socket.on('call-accepted', (data) => {
    if (!trackingActive || String(data.rideId) !== String(currentRideId)) return;
    showActiveCall();
  });
  socket.on('call-declined', (data) => {
    if (!trackingActive || String(data.rideId) !== String(currentRideId)) return;
    callStatusEl.textContent = 'Call declined';
    setTimeout(hideCallOverlay, 1200);
  });
  socket.on('call-ended', (data) => {
    if (!trackingActive || String(data.rideId) !== String(currentRideId)) return;
    hideCallOverlay();
  });

  // --- PAYMENT METHOD (Cash + saved cards, with an "Add card" flow) ---
  function renderPaymentOptions() {
    paymentOptionsEl.querySelectorAll('.payment-option').forEach(el => el.classList.remove('selected'));
    const cashEl = paymentOptionsEl.querySelector('.payment-option[data-method="cash"]');
    if (cashEl && selectedPaymentMethod === 'cash') cashEl.classList.add('selected');

    const cardContainer = document.getElementById('saved-card-options');
    cardContainer.innerHTML = '';
    savedCards.forEach((c, i) => {
      const div = document.createElement('div');
      div.className = 'payment-option card-option' + (selectedPaymentMethod === 'card' && i === 0 ? ' selected' : '');
      div.innerHTML = `💳 <span style="flex:1;">${cardShort(c)}</span><button type="button" class="remove-card-btn" title="Remove card">✕</button>`;
      div.addEventListener('click', () => {
        selectedPaymentMethod = 'card';
        localStorage.setItem('paymentMethod', 'card');
        paymentPillBtn.textContent = paymentPillLabel();
        renderPaymentOptions();
        paymentSheet.close();
      });
      // Remove this card; if it was the selected method (and the last card),
      // fall back to cash so there's always a valid payment method.
      div.querySelector('.remove-card-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        savedCards = savedCards.filter(x => x.id !== c.id);
        persistCards();
        if (!savedCards.length) {
          selectedPaymentMethod = 'cash';
          localStorage.setItem('paymentMethod', 'cash');
        }
        paymentPillBtn.textContent = paymentPillLabel();
        renderPaymentOptions();
      });
      cardContainer.appendChild(div);
    });
  }

  paymentPillBtn.addEventListener('click', () => {
    renderPaymentOptions();
    paymentSheet.open();
  });
  closePayment.addEventListener('click', () => paymentSheet.close());
  paymentOptionsEl.querySelectorAll('.payment-option[data-method="cash"]').forEach(el => {
    el.addEventListener('click', () => {
      selectedPaymentMethod = 'cash';
      localStorage.setItem('paymentMethod', 'cash');
      paymentPillBtn.textContent = PAYMENT_LABELS.cash;
      renderPaymentOptions();
      paymentSheet.close();
    });
  });

  // --- ADD CARD MODAL ---
  const cardModal = document.getElementById('card-modal');
  const cardHolderInput = document.getElementById('card-holder-input');
  const cardNumberInput = document.getElementById('card-number-input');
  const cardExpiryInput = document.getElementById('card-expiry-input');
  const cardCvvInput = document.getElementById('card-cvv-input');
  const cardError = document.getElementById('card-error');
  const cardCancel = document.getElementById('card-cancel');
  const cardSave = document.getElementById('card-save');

  document.getElementById('add-card-option').addEventListener('click', () => {
    paymentSheet.close();
    cardError.textContent = '';
    cardModal.classList.remove('hidden');
    cardHolderInput.focus();
  });
  cardCancel.addEventListener('click', () => cardModal.classList.add('hidden'));

  function detectCardBrand(num) {
    const n = num.replace(/\D/g, '');
    if (/^4/.test(n)) return 'Visa';
    if (/^5[1-5]/.test(n)) return 'Mastercard';
    if (/^3[47]/.test(n)) return 'Amex';
    if (/^6(011|5)/.test(n)) return 'Discover';
    return 'Card';
  }

  // Auto-format while typing: spaces every 4 digits + MM/YY expiry.
  cardNumberInput.addEventListener('input', () => {
    const digits = cardNumberInput.value.replace(/\D/g, '').slice(0, 16);
    cardNumberInput.value = digits.replace(/(.{4})/g, '$1 ').trim();
  });
  cardExpiryInput.addEventListener('input', () => {
    let v = cardExpiryInput.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    cardExpiryInput.value = v;
  });

  cardSave.addEventListener('click', () => {
    const holder = cardHolderInput.value.trim();
    const num = cardNumberInput.value.replace(/\D/g, '');
    const exp = cardExpiryInput.value.trim();
    const cvv = cardCvvInput.value.trim();

    if (!holder) { cardError.textContent = 'Enter the name on the card.'; return; }
    if (!/^\d{13,16}$/.test(num)) { cardError.textContent = 'Enter a valid card number (13-16 digits).'; return; }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp)) { cardError.textContent = 'Enter expiry as MM/YY.'; return; }
    if (!/^\d{3,4}$/.test(cvv)) { cardError.textContent = 'Enter a valid CVV.'; return; }

    // Store only masked details — never the full number or CVV.
    const card = {
      id: Date.now(),
      brand: detectCardBrand(num),
      last4: num.slice(-4),
      exp,
      holder
    };
    savedCards.unshift(card);
    persistCards();
    selectedPaymentMethod = 'card';
    localStorage.setItem('paymentMethod', 'card');
    paymentPillBtn.textContent = `💳 ${cardShort(card)}`;
    cardModal.classList.add('hidden');
    renderPaymentOptions();
  });

  function resetMarkers() {
    if (pickupMarker && window.riderMap) window.riderMap.removeLayer(pickupMarker);
    if (dropoffMarker && window.riderMap) window.riderMap.removeLayer(dropoffMarker);
    if (routeLine && window.riderMap) window.riderMap.removeLayer(routeLine);
    pickupMarker = null; dropoffMarker = null; routeLine = null;
    clickState = 'pickup';
    selectedRideType = 'standard';
    confirmBtn.textContent = 'Request Ride';
    routeInfoText.textContent = 'Select Pickup & Dropoff';
    rideOptionsList.innerHTML = `<div style="color:#6b6b8d; text-align:center;">Tap the map to set locations</div>`;
  }

  // --- LOAD RIDES HISTORY ---
  async function loadRides() {
    try {
      const res = await fetch(`/api/rides?role=rider&riderId=${userId}`);
      const rides = await res.json();
      // Defense-in-depth: only ever render THIS rider's own rides.
      const mine = (Array.isArray(rides) ? rides : []).filter(r => String(r.riderId) === String(userId));
      const container = document.getElementById('rides-list-container');
      container.innerHTML = '';
      if (mine.length === 0) {
        container.innerHTML = '<div style="color:#6b6b8d; text-align:center; padding:40px;">No rides yet.</div>';
        return;
      }
      mine.forEach(ride => {
        const date = new Date(ride.createdAt).toLocaleString();
        const rt = RIDE_TYPES.find(r => r.id === ride.rideType) || RIDE_TYPES[2];
        const from = ride.pickupAddress || `${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}`;
        const to = ride.dropoffAddress || `${ride.dropoff.lat.toFixed(4)}, ${ride.dropoff.lng.toFixed(4)}`;
        container.innerHTML += `
          <div class="ride-history-item">
            <div class="h-info">
              <div class="addr">${rt.icon} ${rt.name} · From: ${from}</div>
              <div class="addr">To: ${to}</div>
              <div style="color:#6b6b8d; font-size:0.8rem;">${date}</div>
            </div>
            <div class="h-price">R${ride.cost || '0'}</div>
          </div>
        `;
      });
    } catch (err) { console.error('Error loading rides:', err); }
  }

  // --- AUTO-SUGGEST DROPDOWN ---
  async function searchWithSuggestions(query, inputElement, isPickup) {
    if (trackingActive) return; // don't allow re-searching mid-trip
    if (query.length < 2) {
      const oldDropdown = document.querySelector('.autocomplete-dropdown');
      if (oldDropdown) oldDropdown.remove();
      return;
    }
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1&countrycodes=za`);
      const data = await res.json();
      const oldDropdown = document.querySelector('.autocomplete-dropdown');
      if (oldDropdown) oldDropdown.remove();
      if (!data || data.length === 0) return;

      const dropdown = document.createElement('div');
      dropdown.className = 'autocomplete-dropdown';
      data.slice(0, 5).forEach(item => {
        const suggestion = document.createElement('div');
        // Full "Place, Suburb, Province" label so identically-named places
        // in different cities (e.g. Greyville in Durban vs Gqeberha) are distinguishable.
        suggestion.textContent = formatAddress(item);
        suggestion.addEventListener('click', () => {
          if (trackingActive) return;
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          const latlng = L.latLng(lat, lng);
          inputElement.value = formatAddress(item);
          dropdown.remove();

          if (!window.riderMap) initRiderMap();
          window.riderMap.setView(latlng, 15);

          if (isPickup) {
            setPickup(latlng);
          } else {
            // ⚠️ SAFETY CHECK: Ensure Pickup is set before Dropoff
            if (!pickupMarker) {
              alert('Please set a Pickup location first by clicking the map or searching for Pickup.');
              return;
            }
            setDropoff(latlng);
          }
        });
        dropdown.appendChild(suggestion);
      });
      inputElement.parentElement.style.position = 'relative';
      inputElement.parentElement.appendChild(dropdown);
    } catch (err) { console.error('Search error:', err); }
  }

  pickupSearch.addEventListener('input', function() { searchWithSuggestions(this.value, this, true); });
  dropoffSearch.addEventListener('input', function() { searchWithSuggestions(this.value, this, false); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-group')) {
      const oldDropdown = document.querySelector('.autocomplete-dropdown');
      if (oldDropdown) oldDropdown.remove();
    }
  });

  switchPage('home');
});