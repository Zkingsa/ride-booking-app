// Connect to Socket.io
const socket = io();

// --- DRIVER MAP SETUP ---
const map = L.map('driver-map').setView([-33.9249, 18.4241], 12);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// Driver's own location marker (Blue dot)
const driverIcon = L.divIcon({
  className: 'driver-icon',
  html: '🟦',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});
let driverMarker = L.marker([-33.9249, 18.4241], { icon: driverIcon }).addTo(map);

// Pickup Marker (Green pin)
const pickupIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
let pickupMarker = null;

// Route Line
let routeLine = null;
// ---------------------------------

const driverRides = document.getElementById('driver-rides');
const goOnlineBtn = document.getElementById('go-online-btn');
const driverStatusText = document.getElementById('driver-status-text');
const logoutBtn = document.getElementById('logout-btn');

// ✅ Wallet DOM elements
const totalEarningsEl = document.getElementById('total-earnings');
const ridesCompletedEl = document.getElementById('rides-completed');

// Logout Button
logoutBtn.addEventListener('click', () => {
  if (isOnline) {
    socket.emit('driver-offline');
  }
  localStorage.clear();
  window.location.href = 'login.html';
});

// Simulate a driver location
let currentDriverLat = -33.9249;
let currentDriverLng = 18.4241;
let isOnline = false;
let activeRideId = null;

// When driver goes Online/Offline
goOnlineBtn.addEventListener('click', () => {
  isOnline = !isOnline;
  
  if (isOnline) {
    goOnlineBtn.textContent = 'Go Offline';
    goOnlineBtn.classList.remove('offline');
    driverStatusText.textContent = 'Status: Online 🟢';
    
    socket.emit('driver-online', { lat: currentDriverLat, lng: currentDriverLng });
  } else {
    goOnlineBtn.textContent = 'Go Online';
    goOnlineBtn.classList.add('offline');
    driverStatusText.textContent = 'Status: Offline';
    
    socket.emit('driver-offline');
    document.getElementById('route-panel').style.display = 'none';
    
    if (activeRideId) {
      socket.emit('driver-cancel-ride', { rideId: activeRideId });
      activeRideId = null;
    }
  }
});

// Helper to render a single ride card
function renderRideCard(ride) {
  const card = document.createElement('div');
  card.className = 'ride-card';
  card.id = `ride-${ride._id}`;
  card.innerHTML = `
    <div class="coords">
      <strong>Pickup:</strong> ${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}<br>
      <strong>Dropoff:</strong> ${ride.dropoff.lat.toFixed(4)}, ${ride.dropoff.lng.toFixed(4)}
    </div>
    <span class="status ${ride.status}">${ride.status}</span>
    ${ride.status === 'pending' ? `<button class="accept-btn" onclick="updateRide('${ride._id}', 'accepted')">Accept</button>` : ''}
    ${ride.status === 'accepted' ? `<button class="complete-btn" onclick="updateRide('${ride._id}', 'completed')">Complete</button>` : ''}
  `;
  return card;
}

async function loadPendingRides() {
  try {
    const response = await fetch('/api/rides');
    const rides = await response.json();
    const activeRides = rides.filter(r => r.status !== 'completed');
    
    if (activeRides.length === 0) {
      driverRides.innerHTML = '<p class="no-rides">No rides available right now.</p>';
      return;
    }
    
    driverRides.innerHTML = '';
    activeRides.forEach(ride => {
      driverRides.appendChild(renderRideCard(ride));
    });
  } catch (err) {
    console.error('Error loading rides:', err);
  }
}

async function updateRide(id, status) {
  try {
    await fetch(`/api/rides/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    // IF DRIVER ACCEPTED, FETCH ROUTE INSTRUCTIONS
    if (status === 'accepted' && isOnline) {
      activeRideId = id;
      
      const rides = await (await fetch('/api/rides')).json();
      const ride = rides.find(r => r._id === id);
      
      if (ride) {
        document.getElementById('route-panel').style.display = 'block';
        
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([ride.pickup.lat, ride.pickup.lng], { icon: pickupIcon })
          .addTo(map)
          .bindPopup('Pickup Location')
          .openPopup();

        const url = `https://router.project-osrm.org/route/v1/driving/${currentDriverLng},${currentDriverLat};${ride.pickup.lng},${ride.pickup.lat}?overview=full&geometries=geojson&steps=true`;
        
        fetch(url)
          .then(res => res.json())
          .then(data => {
            if (data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              document.getElementById('route-distance').textContent = (route.distance / 1000).toFixed(1) + ' km';
              document.getElementById('route-time').textContent = Math.round(route.duration / 60) + ' mins';
              
              if (routeLine) map.removeLayer(routeLine);
              const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
              routeLine = L.polyline(coords, { color: '#00d4aa', weight: 4 }).addTo(map);
              map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

              const turnList = document.getElementById('turn-list');
              turnList.innerHTML = '';
              route.legs[0].steps.forEach(step => {
                const li = document.createElement('li');
                const instruction = step.maneuver.instruction.replace(/<[^>]*>?/gm, '');
                li.textContent = instruction;
                turnList.appendChild(li);
              });
            }
          })
          .catch(err => console.warn("Could not fetch route details:", err));

        startDrivingSimulation(ride.pickup.lat, ride.pickup.lng, id);
      }
    }
  } catch (err) {
    console.error('Error updating ride:', err);
  }
}

// --- DRIVING SIMULATION ---
let moveInterval = null;

function startDrivingSimulation(targetLat, targetLng, rideId) {
  if (moveInterval) clearInterval(moveInterval);
  
  const R = 6371;
  const dLat = (targetLat - currentDriverLat) * (Math.PI / 180);
  const dLng = (targetLng - currentDriverLng) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(currentDriverLat * (Math.PI / 180)) * Math.cos(targetLat * (Math.PI / 180)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  if (distance < 0.1) {
    currentDriverLat = targetLat;
    currentDriverLng = targetLng;
    driverMarker.setLatLng([currentDriverLat, currentDriverLng]);
    socket.emit('driver-location', { lat: currentDriverLat, lng: currentDriverLng, rideId });
    return;
  }

  const steps = 100;
  let stepCount = 0;
  const dLatStep = (targetLat - currentDriverLat) / steps;
  const dLngStep = (targetLng - currentDriverLng) / steps;

  moveInterval = setInterval(() => {
    stepCount++;
    currentDriverLat += dLatStep;
    currentDriverLng += dLngStep;
    
    driverMarker.setLatLng([currentDriverLat, currentDriverLng]);
    socket.emit('driver-location', { lat: currentDriverLat, lng: currentDriverLng, rideId });
    
    if (stepCount >= steps) {
      clearInterval(moveInterval);
      moveInterval = null;
      socket.emit('driver-arrived', { rideId });
    }
  }, 100);
}

// --- SOCKET EVENTS ---
socket.on('new-ride', (ride) => {
  const noRidesMsg = driverRides.querySelector('.no-rides');
  if (noRidesMsg) noRidesMsg.remove();
  const card = renderRideCard(ride);
  driverRides.prepend(card);
});

socket.on('ride-updated', (ride) => {
  const existingCard = document.getElementById(`ride-${ride._id}`);
  if (existingCard) {
    existingCard.replaceWith(renderRideCard(ride));
  }
  if (ride.status === 'completed') {
    document.getElementById('route-panel').style.display = 'none';
    if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (moveInterval) { clearInterval(moveInterval); moveInterval = null; }
    
    // ✅ UPDATE WALLET when ride is completed
    if (ride.cost) {
      updateWallet(ride.cost);
    }
  }
});

// ✅ WALLET UPDATE FUNCTION
async function updateWallet(earnedAmount) {
  try {
    // Fetch all completed rides for this driver
    const res = await fetch('/api/rides');
    const allRides = await res.json();
    
    // Calculate total earnings and ride count (backend should filter by driverId, but we filter globally for the demo)
    const completedRides = allRides.filter(r => r.status === 'completed' && r.cost);
    
    let totalEarnings = 0;
    completedRides.forEach(r => {
      totalEarnings += parseFloat(r.cost);
    });
    
    // Update the UI
    totalEarningsEl.textContent = `R${totalEarnings.toFixed(2)}`;
    ridesCompletedEl.textContent = completedRides.length;
    
  } catch (err) {
    console.error('Error updating wallet:', err);
  }
}

// Load wallet on page start
async function loadWallet() {
  try {
    const res = await fetch('/api/rides');
    const allRides = await res.json();
    const completedRides = allRides.filter(r => r.status === 'completed' && r.cost);
    
    let totalEarnings = 0;
    completedRides.forEach(r => {
      totalEarnings += parseFloat(r.cost);
    });
    
    totalEarningsEl.textContent = `R${totalEarnings.toFixed(2)}`;
    ridesCompletedEl.textContent = completedRides.length;
  } catch (err) {
    console.error('Error loading wallet:', err);
  }
}

// Initial loads
loadPendingRides();
loadWallet();