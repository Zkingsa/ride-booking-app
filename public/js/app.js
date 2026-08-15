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

  // --- LIVE TRACKING STATE ---
  let currentRideId = null;
  let trackingActive = false;
  let driverArrivedAtPickup = false;
  let driverLiveMarker = null;

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
    { id: 'saver', name: 'Saver', icon: '💸', seats: 4, priceMult: 0.7, etaMult: 1.7, sub: 'Cheapest — matched with a driver finishing a nearby trip' }
  ];
  let selectedRideType = 'standard';
  let currentRideCost = 0;

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
  // keeping whichever tier is currently selected highlighted, and wires up
  // tap-to-select on each card.
  function renderRideOptions(dist) {
    const baseTimeEst = Math.max(1, Math.round(dist * 2));
    const basePrice = 15 + (dist * 8);

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
          <div class="price">R${price.toFixed(0)}</div>
        </div>
      `;
    }).join('');

    rideOptionsList.querySelectorAll('.ride-option').forEach(el => {
      el.addEventListener('click', () => {
        selectedRideType = el.dataset.rideType;
        renderRideOptions(dist); // re-render to move the highlight + refresh the button
      });
    });

    updateConfirmButton(basePrice);
  }

  function updateConfirmButton(basePrice) {
    const rt = RIDE_TYPES.find(r => r.id === selectedRideType) || RIDE_TYPES[2];
    currentRideCost = Math.max(5, basePrice * rt.priceMult);
    confirmBtn.textContent = `${rt.icon} Request ${rt.name} (R${currentRideCost.toFixed(0)})`;
  }

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
  });
  closeMapBtn.addEventListener('click', () => {
    pinPickField = null; // cancel any in-progress single-pin pick
    // While tracking, closing the map just hides the view — the ride/socket listeners keep running
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

  // After a single pin-drop pick: if that completed the pair (both pins now
  // set), stay on the map showing the ride sheet — the flow is effectively
  // done. Otherwise it was just filling one field, so hop back to Home.
  function finishPinPick() {
    const bothSet = pickupMarker && dropoffMarker;
    pinPickField = null;
    if (!bothSet) {
      setTimeout(() => { mapScreen.classList.remove('open'); }, 450);
    }
  }

  // --- REQUEST RIDE ---
  confirmBtn.addEventListener('click', async () => {
    if (!pickupMarker || !dropoffMarker) {
      alert('Please set both Pickup and Dropoff on the map first.');
      return;
    }

    const p = pickupMarker.getLatLng();
    const d = dropoffMarker.getLatLng();
    const rt = RIDE_TYPES.find(r => r.id === selectedRideType) || RIDE_TYPES[2];

    const rideData = {
      pickup: { lat: p.lat, lng: p.lng },
      dropoff: { lat: d.lat, lng: d.lng },
      riderId: userId,
      cost: currentRideCost.toFixed(2),
      rideType: rt.id,
      seats: rt.seats
    };
    try {
      const res = await fetch('/api/rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rideData)
      });
      const ride = await res.json();
      startTracking(ride);
    } catch (err) {
      console.error('Error requesting ride:', err);
      alert('Failed to request ride.');
    }
  });

  // --- LIVE DRIVER TRACKING ---
  function startTracking(ride) {
    currentRideId = ride._id;
    trackingActive = true;
    driverArrivedAtPickup = false;

    rideOptionsList.style.display = 'none';
    confirmBtn.style.display = 'none';
    trackingPanel.classList.remove('hidden');
    trackingStatus.textContent = (ride.rideType === 'saver')
      ? '💸 Saver selected — matching you with a driver finishing a nearby trip...'
      : '🔎 Looking for a nearby driver...';
    trackingEta.textContent = '';
    routeInfoText.textContent = `${pickupSearch.value || 'Pickup'} → ${dropoffSearch.value || 'Dropoff'}`;
    // routeLine (pickup → dropoff) from setDropoff() stays on the map through the whole trip.
  }

  function endTracking() {
    trackingActive = false;
    currentRideId = null;
    driverArrivedAtPickup = false;
    if (driverLiveMarker && window.riderMap) { window.riderMap.removeLayer(driverLiveMarker); driverLiveMarker = null; }
    trackingPanel.classList.add('hidden');
    rideOptionsList.style.display = 'block';
    confirmBtn.style.display = 'block';
    resetMarkers();
  }

  // Ride status changes (accepted / completed) pushed from the server
  socket.on('ride-updated', (ride) => {
    if (!trackingActive || ride._id !== currentRideId) return;

    if (ride.status === 'accepted') {
      trackingStatus.textContent = '🚗 Your driver is on the way to pick you up';
    } else if (ride.status === 'completed') {
      trackingStatus.textContent = '✅ Trip completed — thanks for riding!';
      trackingEta.textContent = '';
      setTimeout(() => {
        endTracking();
        mapScreen.classList.remove('open');
        switchPage('rides');
      }, 2500);
    }
  });

  // Live driver GPS position, broadcast every ~100ms while a trip is active.
  // This is what draws "where the car is" and drives the live ETA countdown.
  socket.on('driver-location', (data) => {
    if (!trackingActive || data.rideId !== currentRideId || !window.riderMap) return;

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
      const container = document.getElementById('rides-list-container');
      container.innerHTML = '';
      if (rides.length === 0) {
        container.innerHTML = '<div style="color:#6b6b8d; text-align:center; padding:40px;">No rides yet.</div>';
        return;
      }
      rides.forEach(ride => {
        const date = new Date(ride.createdAt).toLocaleString();
        const rt = RIDE_TYPES.find(r => r.id === ride.rideType) || RIDE_TYPES[2];
        container.innerHTML += `
          <div class="ride-history-item">
            <div class="h-info">
              <div class="addr">${rt.icon} ${rt.name} · From: ${ride.pickup.lat.toFixed(4)}</div>
              <div class="addr">To: ${ride.dropoff.lat.toFixed(4)}</div>
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