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
    clickState = 'dropoff';
    routeInfoText.textContent = '📍 Pickup set — Dropoff?';
    rideOptionsList.innerHTML = `<div style="color:#6b6b8d; text-align:center;">Now tap the map or search for Dropoff</div>`;
  }

  function setDropoff(latlng) {
    if (dropoffMarker) window.riderMap.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(latlng, { icon: redIcon }).addTo(window.riderMap).bindPopup('Dropoff').openPopup();
    clickState = 'done';

    const pickupLatLng = pickupMarker.getLatLng();
    const dropoffLatLng = dropoffMarker.getLatLng();
    routeInfoText.textContent = `${pickupSearch.value || 'Pickup'} → ${dropoffSearch.value || 'Dropoff'}`;

    const dist = calculateDistance(pickupLatLng.lat, pickupLatLng.lng, dropoffLatLng.lat, dropoffLatLng.lng);
    const timeEst = Math.round(dist * 2);
    const priceStd = 15 + (dist * 8);

    rideOptionsList.innerHTML = `
      <div class="ride-option">
        <div class="car-icon">🚗</div>
        <div class="details"><div class="name">Standard Ride</div><div class="sub">${timeEst} min · 4 seats</div></div>
        <div class="price">R${priceStd.toFixed(0)}</div>
      </div>
    `;
    confirmBtn.textContent = `🚗 Request (R${priceStd.toFixed(0)})`;

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

  function initRiderMap() {
    if (window.riderMap) {
      window.riderMap.invalidateSize();
      return;
    }
    window.riderMap = L.map('rider-map').setView([-29.8587, 31.0218], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.riderMap);

    window.riderMap.on('click', (e) => {
      if (trackingActive) return; // don't let taps move markers mid-trip

      if (clickState === 'pickup') {
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
    mapScreen.classList.add('open');
    if (window.riderMap) window.riderMap.invalidateSize();
  });
  closeMapBtn.addEventListener('click', () => {
    // While tracking, closing the map just hides the view — the ride/socket listeners keep running
    mapScreen.classList.remove('open');
  });

  // --- REQUEST RIDE ---
  confirmBtn.addEventListener('click', async () => {
    if (!pickupMarker || !dropoffMarker) {
      alert('Please set both Pickup and Dropoff on the map first.');
      return;
    }

    const p = pickupMarker.getLatLng();
    const d = dropoffMarker.getLatLng();
    const dist = calculateDistance(p.lat, p.lng, d.lat, d.lng);
    const cost = 15 + (dist * 8);

    const rideData = {
      pickup: { lat: p.lat, lng: p.lng },
      dropoff: { lat: d.lat, lng: d.lng },
      riderId: userId,
      cost: cost.toFixed(2)
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
    trackingStatus.textContent = '🔎 Looking for a nearby driver...';
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
        container.innerHTML += `
          <div class="ride-history-item">
            <div class="h-info">
              <div class="addr">From: ${ride.pickup.lat.toFixed(4)}</div>
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