// Initialize the Leaflet map
const map = L.map('map').setView([-29.8587, 31.0218], 12);

// Add OpenStreetMap tiles
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// State variables
let pickupMarker = null;
let dropoffMarker = null;
let clickState = 'pickup';
let currentRouteLine = null;

// Bolt-style DOM refs
const bottomSheet = document.getElementById('bottom-sheet');
const rideInfo = document.getElementById('ride-info');
const requestBtn = document.getElementById('request-btn');
const resetBtn = document.getElementById('reset-btn');
const pickupSearch = document.getElementById('pickup-search');
const dropoffSearch = document.getElementById('dropoff-search');
const clearPickup = document.getElementById('clear-pickup');
const clearDropoff = document.getElementById('clear-dropoff');
const rideDistance = document.getElementById('ride-distance');
const rideTime = document.getElementById('ride-time');
const ridePrice = document.getElementById('ride-price');

// Icons
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

// Toggle Clear Buttons
function toggleClearButton(inputElement) {
  const wrapper = inputElement.parentElement;
  if (inputElement.value.trim().length > 0) {
    wrapper.classList.add('active');
  } else {
    wrapper.classList.remove('active');
  }
}
clearPickup.addEventListener('click', () => { pickupSearch.value = ''; toggleClearButton(pickupSearch); if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; } resetUI(); });
clearDropoff.addEventListener('click', () => { dropoffSearch.value = ''; toggleClearButton(dropoffSearch); if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; } if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; } resetUI(); });

// Reset UI state
function resetUI() {
  if (!pickupMarker || !dropoffMarker) {
    rideInfo.classList.add('hidden');
  }
}

// --- HELPER: Calculate Distance & Price ---
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

function updateRideStats() {
  if (!pickupMarker || !dropoffMarker) return;
  
  const lat1 = pickupMarker.getLatLng().lat;
  const lng1 = pickupMarker.getLatLng().lng;
  const lat2 = dropoffMarker.getLatLng().lat;
  const lng2 = dropoffMarker.getLatLng().lng;
  
  const dist = calculateDistance(lat1, lng1, lat2, lng2);
  const estTime = dist * 2; // Rough estimate: 2 mins per km
  const price = 15 + (dist * 8);
  
  rideDistance.textContent = dist.toFixed(1) + ' km';
  rideTime.textContent = Math.round(estTime) + ' min';
  ridePrice.textContent = 'R' + price.toFixed(2);
  
  rideInfo.classList.remove('hidden');
}

// --- SEARCH AUTOCOMPLETE (OpenStreetMap) ---
async function searchLocation(inputElement, isPickup) {
  const query = inputElement.value.trim();
  if (query.length < 2) {
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.remove();
    return;
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1&countrycodes=za`);
    const data = await res.json();
    
    // Remove old dropdown
    const oldDropdown = document.querySelector('.autocomplete-dropdown');
    if (oldDropdown) oldDropdown.remove();

    if (!data || data.length === 0) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';

    data.slice(0, 5).forEach(item => {
      const suggestion = document.createElement('div');
      let city = item.address?.city || item.address?.town || item.address?.village || '';
      let province = item.address?.state || item.address?.province || '';
      suggestion.textContent = city ? `${item.display_name.split(',')[0]} (${city}, ${province || 'SA'})` : item.display_name;
      
      suggestion.addEventListener('click', () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        const latlng = L.latLng(lat, lng);
        inputElement.value = item.display_name;
        toggleClearButton(inputElement);
        dropdown.remove();
        map.setView(latlng, 15);
        if (isPickup) placePickupMarker(latlng);
        else placeDropoffMarker(latlng);
      });
      dropdown.appendChild(suggestion);
    });
    inputElement.parentElement.appendChild(dropdown);
  } catch (err) { console.error('Autocomplete error:', err); }
}

// Input listeners
pickupSearch.addEventListener('input', function() { searchLocation(this, true); toggleClearButton(this); });
dropoffSearch.addEventListener('input', function() { searchLocation(this, false); toggleClearButton(this); });
document.addEventListener('click', (e) => { if (!e.target.closest('#bottom-sheet')) { const d = document.querySelector('.autocomplete-dropdown'); if (d) d.remove(); } });

// Fallback Enter key
pickupSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') { const d = document.querySelector('.autocomplete-dropdown'); if (d) d.remove(); searchAndPin(this.value, true); } });
dropoffSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') { const d = document.querySelector('.autocomplete-dropdown'); if (d) d.remove(); searchAndPin(this.value, false); } });

async function searchAndPin(query, isPickup) {
  if (!query.trim()) return;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=za`);
    const data = await res.json();
    if (!data || data.length === 0) return;
    const lat = parseFloat(data[0].lat); const lng = parseFloat(data[0].lon); const latlng = L.latLng(lat, lng);
    map.setView(latlng, 15);
    if (isPickup) placePickupMarker(latlng);
    else placeDropoffMarker(latlng);
  } catch (err) { console.error('Search error:', err); }
}

// --- MARKER FUNCTIONS ---
function placePickupMarker(latlng) {
  if (pickupMarker) map.removeLayer(pickupMarker);
  pickupMarker = L.marker(latlng, { icon: greenIcon }).addTo(map).bindPopup('Pickup').openPopup();
  
  // Reverse geocode for address
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`)
    .then(res => res.json())
    .then(data => { if (data.display_name) { pickupSearch.value = data.display_name; toggleClearButton(pickupSearch); } })
    .catch(() => { pickupSearch.value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`; toggleClearButton(pickupSearch); });

  clickState = 'dropoff';
  updateRideStats();
}

function placeDropoffMarker(latlng) {
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  dropoffMarker = L.marker(latlng, { icon: redIcon }).addTo(map).bindPopup('Dropoff').openPopup();
  
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`)
    .then(res => res.json())
    .then(data => { if (data.display_name) { dropoffSearch.value = data.display_name; toggleClearButton(dropoffSearch); } })
    .catch(() => { dropoffSearch.value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`; toggleClearButton(dropoffSearch); });

  // Draw Route Line
  if (currentRouteLine) map.removeLayer(currentRouteLine);
  const pickupLatLng = pickupMarker.getLatLng();
  const dropoffLatLng = dropoffMarker.getLatLng();
  const url = `https://router.project-osrm.org/route/v1/driving/${pickupLatLng.lng},${pickupLatLng.lat};${dropoffLatLng.lng},${dropoffLatLng.lat}?overview=full&geometries=geojson`;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0].geometry.coordinates;
        const latLngs = route.map(coord => [coord[1], coord[0]]);
        currentRouteLine = L.polyline(latLngs, { color: '#00d4aa', weight: 4 }).addTo(map);
        map.fitBounds(currentRouteLine.getBounds(), { padding: [50, 50] });
      }
    })
    .catch(() => console.warn("Could not draw route"));

  clickState = 'done';
  updateRideStats();
}

// --- MAP CLICK HANDLER ---
map.on('click', function (e) {
  if (clickState === 'pickup') placePickupMarker(e.latlng);
  else if (clickState === 'dropoff') placeDropoffMarker(e.latlng);
});

// --- AUTO-DETECT USER LOCATION ---
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => map.setView([position.coords.latitude, position.coords.longitude], 15),
    () => console.warn("Could not get location.")
  );
}

// --- RESET FUNCTION ---
function resetMarkers() {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (currentRouteLine) map.removeLayer(currentRouteLine);
  pickupMarker = null; dropoffMarker = null; currentRouteLine = null;
  clickState = 'pickup';
  pickupSearch.value = ''; dropoffSearch.value = '';
  toggleClearButton(pickupSearch); toggleClearButton(dropoffSearch);
  rideInfo.classList.add('hidden');
}

resetBtn.addEventListener('click', resetMarkers);