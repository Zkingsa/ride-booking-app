// Wait for DOM to be fully ready before attaching listeners or loading data
document.addEventListener('DOMContentLoaded', () => {

  // Request a ride
  requestBtn.addEventListener('click', async () => {
    if (!pickupMarker || !dropoffMarker) return;

    const rideData = {
      pickup: {
        lat: pickupMarker.getLatLng().lat,
        lng: pickupMarker.getLatLng().lng
      },
      dropoff: {
        lat: dropoffMarker.getLatLng().lat,
        lng: dropoffMarker.getLatLng().lng
      }
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
    } catch (err) {
      console.error('Failed to request ride:', err);
    }
  });

  // Load all rides from the database
  async function loadRides() {
    try {
      const res = await fetch('/api/rides');
      const rides = await res.json();
      rides.forEach(addRideToList);
    } catch (err) {
      console.error('Failed to load rides:', err);
    }
  }

  // Display a ride in the sidebar list
  function addRideToList(ride) {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>Pickup:</strong> ${ride.pickup.lat.toFixed(4)}, ${ride.pickup.lng.toFixed(4)}<br>
      <strong>Dropoff:</strong> ${ride.dropoff.lat.toFixed(4)}, ${ride.dropoff.lng.toFixed(4)}<br>
      <span class="status ${ride.status}">${ride.status}</span>
    `;
    ridesList.prepend(li);
  }

  // Initial load
  loadRides();
});