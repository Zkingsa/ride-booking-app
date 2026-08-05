// Initialize the Leaflet map centered on London
const map = L.map('map').setView([51.505, -0.09], 13);

// Add OpenStreetMap tiles as the base layer
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// State variables for tracking markers
let pickupMarker = null;
let dropoffMarker = null;
let clickState = 'pickup';

// Cache DOM element references
const instruction = document.getElementById('instruction');
const rideControls = document.getElementById('ride-controls');
const requestBtn = document.getElementById('request-btn');
const resetBtn = document.getElementById('reset-btn');
const ridesList = document.getElementById('rides-list');

// Define a green icon for pickup markers
const greenIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Define a red icon for dropoff markers
const redIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Handle map clicks to place pickup and dropoff markers
map.on('click', function (e) {
  if (clickState === 'pickup') {
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker(e.latlng, { icon: greenIcon }).addTo(map).bindPopup('Pickup').openPopup();
    clickState = 'dropoff';
    instruction.textContent = 'Now click to set your dropoff location';
  } else if (clickState === 'dropoff') {
    if (dropoffMarker) map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(e.latlng, { icon: redIcon }).addTo(map).bindPopup('Dropoff').openPopup();
    clickState = 'done';
    instruction.textContent = 'Ready! Click "Request Ride" to submit.';
    rideControls.classList.remove('hidden');
  }
});

// Remove both markers and reset state
function resetMarkers() {
  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  pickupMarker = null;
  dropoffMarker = null;
  clickState = 'pickup';
  instruction.textContent = 'Click the map to set your pickup location';
  rideControls.classList.add('hidden');
}

resetBtn.addEventListener('click', resetMarkers);
