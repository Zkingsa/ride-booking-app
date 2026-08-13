document.addEventListener('DOMContentLoaded', () => {
  // AUTH CHECK
  const userRole = localStorage.getItem('userRole');
  if (!userRole || userRole !== 'rider') {
    window.location.href = 'login.html';
    return;
  }

  const requestBtn = document.getElementById('request-btn');
  const ridesList = document.getElementById('rides-list');
  const onlineDriverCount = document.getElementById('online-driver-count');
  const activeRideCount = document.getElementById('active-ride-count');
  const logoutBtn = document.getElementById('logout-btn');

  // Logout
  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });

  // Trip Cost Estimator
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Request a ride
  requestBtn.addEventListener('click', async () => {
    if (!pickupMarker || !dropoffMarker) return;

    const dist = calculateDistance(
      pickupMarker.getLatLng().lat, pickupMarker.getLatLng().lng,
      dropoffMarker.getLatLng().lat, dropoffMarker.getLatLng().lng
    );
    const cost = 15 + (dist * 8);
    
    if (!confirm(`Distance: ${dist.toFixed(1)} km\nEstimated Cost: R${cost.toFixed(2)}\nConfirm Booking?`)) return;

    const rideData = {
      pickup: { lat: pickupMarker.getLatLng().lat, lng: pickupMarker.getLatLng().lng },
      dropoff: { lat: dropoffMarker.getLatLng().lat, lng: dropoffMarker.getLatLng().lng },
      riderId: localStorage.getItem('userId'),
      cost: cost.toFixed(2)
    };

    try {
      const res = await fetch('/api/rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rideData)
      });
      const ride = await res.json();
      addRideToList(ride);
      resetMarkers();
    } catch (err) { console.error('Failed to request ride:', err); }
  });

  async function loadRides() {
    try {
      const res = await fetch('/api/rides');
      const rides = await res.json();
      ridesList.innerHTML = '';
      for (const ride of rides) await addRideToList(ride);
    } catch (err) { console.error('Failed to load rides:', err); }
  }

  async function getOSMAddress(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
  }

  async function addRideToList(ride) {
    const pickupAddr = await getOSMAddress(ride.pickup.lat, ride.pickup.lng);
    const dropoffAddr = await getOSMAddress(ride.dropoff.lat, ride.dropoff.lng);
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>Pickup:</strong> ${pickupAddr}<br>
      <strong>Dropoff:</strong> ${dropoffAddr}<br>
      ${ride.cost ? `<strong>Cost: R${ride.cost}</strong><br>` : ''}
      <span class="status ${ride.status}">${ride.status}</span>
      ${ride.status === 'accepted' ? `<button onclick="openChat('${ride._id}')" style="margin-top:5px; background:#6c63ff; color:#fff; padding:4px 12px; font-size:0.8rem;">💬 Chat</button>` : ''}
    `;
    ridesList.prepend(li);
  }

  loadRides();
});

// Socket & Chat Logic
const socket = io();
let driverMarker = null;
let currentChatRideId = null;

socket.on('driver-stats', (data) => {
  document.getElementById('online-driver-count').textContent = data.onlineDrivers || 0;
  document.getElementById('active-ride-count').textContent = data.activeRides || 0;
});

socket.on('driver-location', (data) => {
  const latlng = L.latLng(data.lat, data.lng);
  if (!driverMarker) {
    const carIcon = L.divIcon({ className: 'car-icon', html: '🚗', iconSize: [30, 30], iconAnchor: [15, 15] });
    driverMarker = L.marker(latlng, { icon: carIcon }).addTo(map);
  } else driverMarker.setLatLng(latlng);
});

socket.on('driver-arrived', () => {
  alert('🚗 Your driver has arrived!');
  if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
});

socket.on('driver-offline', () => {
  if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
});

// Chat functions
function openChat(rideId) {
  currentChatRideId = rideId;
  document.getElementById('chat-modal').style.display = 'flex';
  document.getElementById('chat-messages').innerHTML = '';
  
  socket.emit('join-ride-room', rideId);
  // Load previous messages
  fetch(`/api/messages/${rideId}`).then(res => res.json()).then(msgs => {
    msgs.forEach(msg => addChatMessage(msg));
  });
}

document.getElementById('close-chat').addEventListener('click', () => {
  document.getElementById('chat-modal').style.display = 'none';
});

document.getElementById('send-chat-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const msg = document.getElementById('chat-input').value.trim();
  if (!msg || !currentChatRideId) return;
  
  const data = {
    rideId: currentChatRideId,
    senderId: localStorage.getItem('userId'),
    senderName: localStorage.getItem('userName') || 'Rider',
    message: msg
  };
  
  socket.emit('send-message', data);
  document.getElementById('chat-input').value = '';
}

socket.on('new-message', (msg) => {
  addChatMessage(msg);
});

function addChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const myId = localStorage.getItem('userId');
  div.className = msg.senderId === myId ? 'me' : 'them';
  div.innerHTML = `<strong>${msg.senderName}</strong><br>${msg.message}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}