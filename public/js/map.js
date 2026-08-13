// Initialize the Leaflet map
const map = L.map('map').setView([-33.9249, 18.4241], 13);

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

// DOM refs
const instruction = document.getElementById('instruction');
const rideControls = document.getElementById('ride-controls');
const requestBtn = document.getElementById('request-btn');
const resetBtn = document.getElementById('reset-btn');
const pickupSearch = document.getElementById('pickup-search');
const dropoffSearch = document.getElementById('dropoff-search');
const clearPickup = document.getElementById('clear-pickup');
const clearDropoff = document.getElementById('clear-dropoff');
const pickupWrapper = clearPickup.parentElement;
const dropoffWrapper = clearDropoff.parentElement;

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

// ================================================================
// AUTO-COMPLETE DROPDOWN SYSTEM (RSA Focused)
// ================================================================

function showSuggestions(inputElement, results, isPickup) {
  const existingDropdown = document.querySelector('.autocomplete-dropdown');
  if (existingDropdown) existingDropdown.remove();

  if (!results || results.length === 0) {
    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';
    
    const noResultMsg = document.createElement('div');
    noResultMsg.textContent = 'No locations found in South Africa. Try a different spelling or click the map.';
    noResultMsg.style.cssText = 'color: #777799; cursor: default; font-style: italic;';
    noResultMsg.addEventListener('mouseenter', () => { noResultMsg.style.background = 'transparent'; });
    
    dropdown.appendChild(noResultMsg);
    inputElement.parentElement.appendChild(dropdown);
    return;
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';

  results.slice(0, 5).forEach(item => {
    const suggestion = document.createElement('div');
    
    // Extract city and province for better identification
    let city = '';
    let province = '';
    if (item.address) {
      city = item.address.city || item.address.town || item.address.village || '';
      province = item.address.state || item.address.province || '';
    }

    // Show the address plus the city in parentheses for easy identification
    let displayText = item.display_name;
    if (city) {
      displayText = `${item.display_name.split(',')[0]} (${city}, ${province || 'SA'})`;
    }

    suggestion.textContent = displayText;
    
    suggestion.addEventListener('click', () => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      const latlng = L.latLng(lat, lng);
      
      inputElement.value = item.display_name;
      toggleClearButton(inputElement);
      dropdown.remove();
      
      map.setView(latlng, 16);

      if (isPickup) placePickupMarker(latlng, item.display_name);
      else placeDropoffMarker(latlng, item.display_name);
    });

    dropdown.appendChild(suggestion);
  });

  inputElement.parentElement.appendChild(dropdown);
}

async function searchWithSuggestions(inputElement, isPickup) {
  const query = inputElement.value.trim();
  if (query.length < 2) {
    const existingDropdown = document.querySelector('.autocomplete-dropdown');
    if (existingDropdown) existingDropdown.remove();
    return;
  }

  try {
    // KEY CHANGE: Added 'countrycodes=za' to force OpenStreetMap to ONLY look in South Africa!
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1&countrycodes=za`);
    const data = await res.json();
    showSuggestions(inputElement, data, isPickup);
  } catch (error) {
    console.error('Autocomplete error:', error);
  }
}

pickupSearch.addEventListener('input', function() {
  searchWithSuggestions(this, true);
  toggleClearButton(this);
});
dropoffSearch.addEventListener('input', function() {
  searchWithSuggestions(this, false);
  toggleClearButton(this);
});

// Remove dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-container')) {
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.remove();
  }
});

// Fallback Enter key search (No alert boxes)
pickupSearch.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.remove();
    searchAndPin(this.value, true);
  }
});
dropoffSearch.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    const dropdown = document.querySelector('.autocomplete-dropdown');
    if (dropdown) dropdown.remove();
    searchAndPin(this.value, false);
  }
});

async function searchAndPin(query, isPickup) {
  if (!query.trim()) return;
  try {
    // Force South African search for fallback too
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=za`);
    const data = await res.json();
    if (!data || data.length === 0) {
      return;
    }
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    const displayName = data[0].display_name;
    const latlng = L.latLng(lat, lng);
    map.setView(latlng, 15);
    if (isPickup) placePickupMarker(latlng, displayName);
    else placeDropoffMarker(latlng, displayName);
  } catch (error) {
    console.error('Search error:', error);
  }
}

// ================================================================
// CLEAR 'X' BUTTON LOGIC
// ================================================================

function toggleClearButton(inputElement) {
  const wrapper = inputElement.parentElement;
  if (inputElement.value.trim().length > 0) {
    wrapper.classList.add('active');
  } else {
    wrapper.classList.remove('active');
  }
}

clearPickup.addEventListener('click', function() {
  pickupSearch.value = '';
  toggleClearButton(pickupSearch);
  if (pickupMarker) {
    map.removeLayer(pickupMarker);
    pickupMarker = null;
  }
  if (clickState === 'done' && !dropoffMarker) {
    clickState = 'pickup';
    instruction.textContent = 'Type a place (Press Enter) or click the map';
  }
});

clearDropoff.addEventListener('click', function() {
  dropoffSearch.value = '';
  toggleClearButton(dropoffSearch);
  if (dropoffMarker) {
    map.removeLayer(dropoffMarker);
    dropoffMarker = null;
  }
  if (currentRouteLine) {
    map.removeLayer(currentRouteLine);
    currentRouteLine = null;
  }
  if (clickState === 'done') {
    clickState = 'dropoff';
    rideControls.classList.add('hidden');
    instruction.textContent = 'Type a place or click the map to set your dropoff location';
  }
});

// ================================================================
// REVERSE GEOCODE & MARKER FUNCTIONS
// ================================================================

async function getAddressFromOSM(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

async function placePickupMarker(latlng, address) {
  if (pickupMarker) map.removeLayer(pickupMarker);
  pickupMarker = L.marker(latlng, { icon: greenIcon }).addTo(map).bindPopup('Pickup').openPopup();
  if (address) {
    pickupSearch.value = address;
    toggleClearButton(pickupSearch);
  } else {
    pickupSearch.value = await getAddressFromOSM(latlng.lat, latlng.lng);
    toggleClearButton(pickupSearch);
  }
  clickState = 'dropoff';
  instruction.textContent = 'Type a place or click the map to set your dropoff location';
}

async function placeDropoffMarker(latlng, address) {
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  dropoffMarker = L.marker(latlng, { icon: redIcon }).addTo(map).bindPopup('Dropoff').openPopup();
  if (address) {
    dropoffSearch.value = address;
    toggleClearButton(dropoffSearch);
  } else {
    dropoffSearch.value = await getAddressFromOSM(latlng.lat, latlng.lng);
    toggleClearButton(dropoffSearch);
  }
  
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
      }
    })
    .catch(() => console.warn("Could not draw route"));

  clickState = 'done';
  instruction.textContent = 'Ready! Click "Request Ride" to submit.';
  rideControls.classList.remove('hidden');
}

map.on('click', function (e) {
  if (clickState === 'pickup') placePickupMarker(e.latlng);
  else if (clickState === 'dropoff') placeDropoffMarker(e.latlng);
});

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => map.setView([position.coords.latitude, position.coords.longitude], 15),
    () => console.warn("Could not get location.")
  );
}

function resetMarkers() {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (currentRouteLine) map.removeLayer(currentRouteLine);
  pickupMarker = null;
  dropoffMarker = null;
  currentRouteLine = null;
  clickState = 'pickup';
  pickupSearch.value = '';
  dropoffSearch.value = '';
  toggleClearButton(pickupSearch);
  toggleClearButton(dropoffSearch);
  instruction.textContent = 'Type a place (Press Enter) or click the map';
  rideControls.classList.add('hidden');
}

resetBtn.addEventListener('click', resetMarkers);