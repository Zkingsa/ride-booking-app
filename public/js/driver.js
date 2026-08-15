const socket = io();
const driverId = localStorage.getItem('userId');
const driverName = localStorage.getItem('userName') || 'Driver';

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
let isOnline = false;
let activeRideId = null;
let activeRideDropoff = null;
let moveInterval = null;

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
function renderEarnPage() {
  pageContent.innerHTML = `
    <div class="page-card"><div class="row"><div><div class="title">Earn more</div><div class="sub">Refer a friend</div></div><span class="amount">R800</span></div></div>
    <div class="page-card"><div class="row"><div><div class="title">Save on essentials</div><div class="sub">Driver discounts</div></div><span class="amount">➜</span></div></div>
  `;
}

async function renderRidesPage() {
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    const completed = rides.filter(r => r.status === 'completed');
    
    let html = '';
    completed.forEach(r => {
      const date = new Date(r.createdAt).toLocaleDateString();
      html += `
        <div class="history-item">
          <div class="info"><h4>Trip</h4><p>${date}</p></div>
          <div class="price">R${r.cost || '0.00'}</div>
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
goOnlineBtn.addEventListener('click', () => {
  isOnline = !isOnline;
  if (isOnline) {
    goOnlineBtn.textContent = 'Go offline';
    goOnlineBtn.classList.remove('offline');
    socket.emit('driver-online', { lat: currentDriverLat, lng: currentDriverLng });
  } else {
    goOnlineBtn.textContent = 'Go online';
    goOnlineBtn.classList.add('offline');
    socket.emit('driver-offline');
    bottomSheet.style.display = 'none';
    document.getElementById('route-panel').style.display = 'none';
    if (activeRideId) { socket.emit('driver-cancel-ride', { rideId: activeRideId }); activeRideId = null; activeRideDropoff = null; }
  }
});

// --- RIDE CARDS ---
function renderRideCard(ride) {
  const card = document.createElement('div');
  card.className = 'ride-card';
  card.id = `ride-${ride._id}`;
  card.style.cssText = 'background:#1a1a2e; padding:12px; border-radius:12px; margin-bottom:8px;';
  card.innerHTML = `
    <div style="font-size:0.85rem; color:#ccc;"><strong>Pickup:</strong> ${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}</div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
      <span class="status ${ride.status}" style="padding:2px 8px; border-radius:10px; font-size:0.7rem;">${ride.status}</span>
      ${ride.status === 'pending' ? `<button class="accept-btn" onclick="updateRide('${ride._id}', 'accepted')" style="background:#00d4aa; color:#0d0d1a; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">Accept</button>` : ''}
      ${ride.status === 'accepted' ? `<button class="complete-btn" onclick="updateRide('${ride._id}', 'completed')" style="background:#6c63ff; color:#fff; border:none; padding:6px 16px; border-radius:20px; font-weight:600; cursor:pointer;">Complete</button>` : ''}
    </div>
  `;
  return card;
}

async function loadPendingRides() {
  try {
    const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
    const rides = await res.json();
    const active = rides.filter(r => r.status !== 'completed');
    
    if (active.length === 0) {
      bottomSheet.style.display = 'none';
      return;
    }
    bottomSheet.style.display = 'block';
    driverRides.innerHTML = '';
    active.forEach(ride => driverRides.appendChild(renderRideCard(ride)));
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
        map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
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
async function updateRide(id, status) {
  try {
    await fetch(`/api/rides/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, driverId: status === 'accepted' ? driverId : null }) });
    if (status === 'accepted' && isOnline) {
      activeRideId = id;
      const res = await fetch(`/api/rides?role=driver&driverId=${driverId}`);
      const rides = await res.json();
      const ride = rides.find(r => r._id === id);
      if (ride) {
        activeRideDropoff = ride.dropoff;
        document.getElementById('route-panel').style.display = 'block';

        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([ride.pickup.lat, ride.pickup.lng], { icon: pickupIcon }).addTo(map).bindPopup('Pickup').openPopup();

        if (dropoffMarkerDriver) map.removeLayer(dropoffMarkerDriver);
        dropoffMarkerDriver = L.marker([ride.dropoff.lat, ride.dropoff.lng], { icon: dropoffIcon }).addTo(map).bindPopup('Drop-off');

        // Show the whole trip path (pickup -> dropoff) as a reference, and the
        // live route (driver -> next target) which updates as legs progress.
        drawTripRoute(ride.pickup, ride.dropoff);
        drawRouteToTarget(ride.pickup.lat, ride.pickup.lng);

        // Leg 1: drive to pickup. On arrival, automatically continue to drop-off
        // so the rider (and driver) see continuous, real-time tracking through the whole trip.
        startDrivingSimulation(ride.pickup.lat, ride.pickup.lng, id, () => {
          socket.emit('driver-arrived', { rideId: id });

          if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }

          if (activeRideDropoff) {
            drawRouteToTarget(activeRideDropoff.lat, activeRideDropoff.lng);
            // Leg 2: drive from pickup to drop-off
            startDrivingSimulation(activeRideDropoff.lat, activeRideDropoff.lng, id, () => {
              socket.emit('driver-reached-dropoff', { rideId: id });
            });
          }
        });
      }
    }
  } catch (err) { console.error('Error updating ride:', err); }
}

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

    // Broadcast to rider in real time
    socket.emit('driver-location', { lat: currentDriverLat, lng: currentDriverLng, rideId });

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
  const noRidesMsg = driverRides.querySelector('.no-rides');
  if (noRidesMsg) noRidesMsg.remove();
  driverRides.prepend(renderRideCard(ride));
  bottomSheet.style.display = 'block';
});

socket.on('ride-updated', (ride) => {
  const existingCard = document.getElementById(`ride-${ride._id}`);
  if (existingCard) existingCard.replaceWith(renderRideCard(ride));
  if (ride.status === 'completed') {
    document.getElementById('route-panel').style.display = 'none';
    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (dropoffMarkerDriver) { map.removeLayer(dropoffMarkerDriver); dropoffMarkerDriver = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (tripRouteLine) { map.removeLayer(tripRouteLine); tripRouteLine = null; }
    if (moveInterval) { clearInterval(moveInterval); moveInterval = null; }
    activeRideId = null;
    activeRideDropoff = null;
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
    document.getElementById('total-earnings').textContent = `R${total.toFixed(2)}`;
  } catch { }
}
updateEarnings();
loadPendingRides();